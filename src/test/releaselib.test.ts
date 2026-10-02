import * as assert from 'assert';
import { mock } from 'node:test';

const actionsLog = require('../../../scripts/lib/actions-log');
const { parseFlags } = require('../../../scripts/lib/flags');
const { gh } = require('../../../scripts/lib/github');
const openrouter = require('../../../scripts/lib/openrouter');
const childProcess = require('child_process');

function budget(remaining = 60000, signal = new AbortController().signal) {
    return { signal, remaining: () => remaining };
}

function rateLimit() {
    return Object.assign(new Error('rate limited'), { status: 429 });
}

describe('scripts/lib/flags', function () {
    const spec = {
        '--output': 'output',
        '--dry-run': { name: 'dryRun', value: true },
        '--count': { name: 'count', parse: Number },
    };

    it('keeps defaults, aliases and booleans without consuming the next flag', function () {
        const defaults = { output: '', dryRun: false };
        assert.deepStrictEqual(parseFlags(['--dry-run', '--output', 'file.json'], spec, { defaults }),
            { output: 'file.json', dryRun: true });
        assert.deepStrictEqual(defaults, { output: '', dryRun: false });
    });

    it('applies conversions and keeps the last repeated value', function () {
        assert.deepStrictEqual(parseFlags(['--count', '1', '--count', '2'], spec), { count: 2 });
    });

    it('ignores unknown arguments without swallowing the next known flag', function () {
        assert.deepStrictEqual(parseFlags(['--unknown', 'ignored', 'toString', '--output', 'file'], spec), { output: 'file' });
    });

    it('preserves permissive missing values and flag-looking values', function () {
        assert.deepStrictEqual(parseFlags(['--output'], spec), { output: undefined });
        assert.deepStrictEqual(parseFlags(['--output', '--dry-run'], spec), { output: '--dry-run' });
    });

    it('lets conversions keep the current value when an argument is missing', function () {
        assert.deepStrictEqual(parseFlags(['--output', 'first', '--output'], {
            '--output': { name: 'output', parse: (value: string, options: { output: string }) => value || options.output },
        }), { output: 'first' });
    });

    it('keeps strict missing-value and unknown-option failures distinct', function () {
        assert.throws(() => parseFlags(['--output'], spec, { strict: true }), /Missing value for --output/);
        assert.throws(() => parseFlags(['--unknown', 'value'], spec, { strict: true }), /Unknown option --unknown/);
        assert.throws(() => parseFlags(['--unknown'], spec, { strict: true }), /Missing value for --unknown/);
    });
});

describe('scripts/lib/actions-log', function () {
    it('writes annotations only to stderr, keeping stdout available for results', function () {
        const stdout = process.stdout.write;
        const stderr = process.stderr.write;
        const output: string[] = [];
        const annotations: string[] = [];
        process.stdout.write = ((chunk: string) => { output.push(chunk); return true; }) as typeof stdout;
        process.stderr.write = ((chunk: string) => { annotations.push(chunk); return true; }) as typeof stderr;
        try {
            actionsLog.warn('warning');
            actionsLog.notice('notice');
            actionsLog.warn('uncovered', { file: 'src/file.ts', line: 3 });
        } finally {
            process.stdout.write = stdout;
            process.stderr.write = stderr;
        }
        assert.deepStrictEqual(output, []);
        assert.deepStrictEqual(annotations, ['::warning::warning\n', '::notice::notice\n',
            '::warning file=src/file.ts,line=3::uncovered\n']);
    });
});

describe('scripts/lib/github', function () {
    afterEach(function () { mock.restoreAll(); });

    it('executes argv directly and captures both streams', function () {
        mock.method(childProcess, 'execFileSync', (command: string, args: string[], options: unknown) => {
            assert.strictEqual(command, 'gh');
            assert.deepStrictEqual(args, ['issue', 'view', '1', '--repo', 'a/b']);
            assert.deepStrictEqual(options, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
            return 'result\n';
        });
        assert.strictEqual(gh(['issue', 'view', '1', '--repo', 'a/b']), 'result\n');
    });

    it('preserves CLI errors and their stderr for the caller', function () {
        const error = Object.assign(new Error('failed'), { stderr: 'not authorized' });
        mock.method(childProcess, 'execFileSync', () => { throw error; });
        assert.throws(() => gh(['api', 'repos/a/b/pulls']), (found: unknown) => found === error);
    });
});

describe('scripts/lib/openrouter', function () {
    let fetch: typeof globalThis.fetch;
    let model: string | undefined;

    beforeEach(function () {
        fetch = globalThis.fetch;
        model = process.env.OPENROUTER_MODEL;
    });

    afterEach(function () {
        globalThis.fetch = fetch;
        if (model === undefined) {
            delete process.env.OPENROUTER_MODEL;
        } else {
            process.env.OPENROUTER_MODEL = model;
        }
        mock.timers.reset();
        mock.restoreAll();
    });

    it('uses the shared model default and honors a trimmed override', function () {
        process.env.OPENROUTER_MODEL = '  ';
        assert.strictEqual(openrouter.modelName(), 'z-ai/glm-5.2:free');
        process.env.OPENROUTER_MODEL = ' test/model ';
        const messages = [{ role: 'user', content: 'question' }];
        assert.deepStrictEqual(openrouter.request(messages, 500, { response_format: { type: 'json_object' } }), {
            model: 'test/model', messages, temperature: 0.2, seed: 7, max_tokens: 500,
            response_format: { type: 'json_object' },
        });
    });

    it('reads message content and treats a missing choice as empty', function () {
        assert.strictEqual(openrouter.messageContent({ choices: [{ message: { content: 'reply' } }] }), 'reply');
        assert.strictEqual(openrouter.messageContent({ choices: [] }), '');
        assert.strictEqual(openrouter.messageContent(undefined), '');
    });

    it('creates the existing six-minute deadline with a caller override', function () {
        let now = 1000;
        mock.method(Date, 'now', () => now);
        const shared = openrouter.createBudget();
        assert.strictEqual(shared.remaining(), 360000);
        const short = openrouter.createBudget(50);
        now += 20;
        assert.strictEqual(short.remaining(), 30);
    });

    it('preserves caller attribution, request data and the shared abort signal', async function () {
        const controller = new AbortController();
        let signal: AbortSignal | undefined;
        globalThis.fetch = (async (url: string, init: { headers: unknown; body: string; method: string; signal: AbortSignal }) => {
            assert.strictEqual(url, 'https://openrouter.ai/api/v1/chat/completions');
            assert.strictEqual(init.method, 'POST');
            assert.deepStrictEqual(init.headers, {
                Authorization: 'Bearer key', 'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/MillenniumDawn/MD-VSCode-Utility-Tool', 'X-Title': 'caller title',
            });
            assert.deepStrictEqual(JSON.parse(init.body), { messages: [] });
            signal = init.signal;
            return { ok: true, json: async () => ({ result: true }) };
        }) as unknown as typeof globalThis.fetch;
        assert.deepStrictEqual(await openrouter.post('/chat/completions', { messages: [] }, 'key', {
            budget: budget(60000, controller.signal), title: 'caller title',
        }), { result: true });
        controller.abort();
        assert.strictEqual(signal?.aborted, true);
    });

    it('preserves HTTP status and limits error details', async function () {
        globalThis.fetch = (async () => ({ ok: false, status: 429, text: async () => 'x'.repeat(500) })) as unknown as typeof globalThis.fetch;
        await assert.rejects(() => openrouter.post('/chat/completions', {}, 'key', { budget: budget(), title: 'title' }),
            (error: unknown) => {
                assert.strictEqual((error as { status: number }).status, 429);
                assert.strictEqual((error as Error).message, `OpenRouter returned 429: ${'x'.repeat(300)}`);
                return true;
            });
    });

    it('keeps the HTTP failure when reading its error body also fails', async function () {
        globalThis.fetch = (async () => ({ ok: false, status: 500, text: async () => { throw new Error('body failed'); } })) as unknown as typeof globalThis.fetch;
        await assert.rejects(() => openrouter.post('/chat/completions', {}, 'key', { budget: budget(), title: 'title' }),
            /OpenRouter returned 500/);
    });

    it('does not retry non-rate-limit failures or waits it cannot afford', async function () {
        for (const [error, remaining] of [[new Error('network'), 60000], [rateLimit(), 20000], [rateLimit(), 0]] as const) {
            let calls = 0;
            await assert.rejects(() => openrouter.withRateLimitRetry(() => { calls++; throw error; }, budget(remaining)),
                (found: unknown) => found === error);
            assert.strictEqual(calls, 1);
        }
    });

    it('retries a rate limit once after twenty seconds when the budget allows', async function () {
        mock.timers.enable({ apis: ['setTimeout'] });
        let calls = 0;
        const result = openrouter.withRateLimitRetry(() => {
            if (++calls === 1) {
                throw rateLimit();
            }
            return 'reply';
        }, budget());
        mock.timers.tick(19999);
        assert.strictEqual(calls, 1);
        mock.timers.tick(1);
        assert.strictEqual(await result, 'reply');
        assert.strictEqual(calls, 2);
    });

    it('does not retry a second rate limit', async function () {
        mock.timers.enable({ apis: ['setTimeout'] });
        const error = rateLimit();
        let calls = 0;
        const result = openrouter.withRateLimitRetry(() => { calls++; throw error; }, budget());
        mock.timers.tick(20000);
        await assert.rejects(() => result, (found: unknown) => found === error);
        assert.strictEqual(calls, 2);
    });

    it('aborts a rate-limit wait without sending another request', async function () {
        const controller = new AbortController();
        let calls = 0;
        const result = openrouter.withRateLimitRetry(() => { calls++; throw rateLimit(); }, budget(60000, controller.signal));
        controller.abort();
        await assert.rejects(() => result, /abort/i);
        assert.strictEqual(calls, 1);
    });

    it('does not retry if the remaining budget runs out during the wait', async function () {
        mock.timers.enable({ apis: ['setTimeout'] });
        let remaining = 60000;
        let calls = 0;
        const error = rateLimit();
        const result = openrouter.withRateLimitRetry(() => { calls++; throw error; }, {
            signal: new AbortController().signal, remaining: () => remaining,
        });
        remaining = 0;
        mock.timers.tick(20000);
        await assert.rejects(() => result, (found: unknown) => found === error);
        assert.strictEqual(calls, 1);
    });
});
