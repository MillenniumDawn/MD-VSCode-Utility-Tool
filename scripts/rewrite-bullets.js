// Rewrites seeded changelog bullets from pull request titles into the wording CHANGELOG.md uses,
// through OpenRouter.
//
//   node scripts/rewrite-bullets.js --bullets-file bullets.json
//   node scripts/rewrite-bullets.js --check
//
// .github/workflows/version-bump.yml runs this once per pull request, on the bullets it has just
// seeded and never on one already in the release pull request -- so a bullet reworded by hand is
// never sent anywhere and never rewritten twice.
//
// Three tiers, each falling through to the next:
//
//   1. one structured call for the whole release, so the model sees every bullet at once and keeps
//      the tone consistent across them
//   2. a plain-text call per bullet, for the ones the structured reply got wrong
//   3. the seeded wording, which is what the bullets already say
//
// Nothing here is allowed to fail the job. A release pull request that cannot open because an
// external API is down would be a worse problem than a changelog written from pull request titles,
// so every error path is a `::warning::` and an exit code of 0.

'use strict';

const fs = require('fs');

const endpoint = 'https://openrouter.ai/api/v1';
// Free, 256k context, and one of the few free models on OpenRouter that supports structured
// outputs and `seed`. Overridden by the OPENROUTER_MODEL repository variable.
const defaultModel = 'z-ai/glm-5.2:free';
// A changelog bullet is one or two sentences. Well past that is the model explaining itself.
const maxBulletLength = 600;
const maxBullets = 30;
const timeoutMs = 120000;

const style = [
	'You write the changelog for a Visual Studio Code extension that previews Hearts of Iron IV mod files.',
	'Rewrite each entry as one or two plain sentences describing what is different for someone using the extension.',
	'',
	'Rules:',
	'- Say what changed and, where it helps, why it was wrong before.',
	'- Never mention internals: no function names, no type names, no file paths, and no counts of nodes, bytes or lint warnings.',
	'- Never describe how it was implemented.',
	'- Hearts of Iron IV game syntax is fine and welcome, because that is what the reader has open in the editor: random_list, var:my_array^0, FROM, focus_tree.',
	'- Write in the present tense about the new behaviour, not about the pull request.',
	'- No marketing language, no exclamation marks, no "we".',
	'- Do not start with a dash, and do not write a "[ Component ]" prefix or an "Issue #NN." suffix. Both are added afterwards.',
	'- If the title says too little to expand on, return it as a plain sentence rather than inventing detail.',
].join('\n');

function warn(message) {
	process.stdout.write(`::warning::${message}\n`);
}

function notice(message) {
	process.stdout.write(`::notice::${message}\n`);
}

function modelName() {
	return process.env.OPENROUTER_MODEL?.trim() || defaultModel;
}

// A reasoning model can wrap its answer in a fence or lead with a stray line. Take the fenced
// content when there is a fence, and otherwise the last non-empty line, which is the answer when
// anything precedes it and the whole reply when nothing does.
function cleanReply(text) {
	const raw = String(text ?? '').trim();
	const fenced = /```(?:\w+)?\s*\n([\s\S]*?)\n?```/.exec(raw);
	const body = (fenced ? fenced[1] : raw).trim();
	const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	return lines.length > 0 ? lines[lines.length - 1] : '';
}

// The prefix and the issue trailer are ours to add, so a reply that writes its own is rejected
// rather than repaired -- a model that ignored those two rules probably ignored the others.
function acceptable(text) {
	const value = String(text ?? '').trim();
	return value.length > 0
		&& value.length <= maxBulletLength
		&& !/[\r\n]/.test(value)
		&& !value.startsWith('-')
		&& !value.startsWith('[')
		&& !/\bIssue #\d+/i.test(value);
}

// "Fix the thing." plus a component and an issue becomes the finished changelog line.
function assemble(text, entry) {
	let sentence = String(text ?? '').trim();
	if (!/[.!?]$/.test(sentence)) {
		sentence += '.';
	}
	const prefix = entry?.component ? `[ ${entry.component} ] ` : '';
	const suffix = entry?.issue === undefined || entry?.issue === null || entry?.issue === '' ? '' : ` Issue #${entry.issue}.`;
	return `- ${prefix}${sentence}${suffix}`;
}

async function post(path, body, key) {
	const response = await fetch(`${endpoint}${path}`, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${key}`,
			'Content-Type': 'application/json',
			// OpenRouter attributes usage to these; they are not required and carry nothing private.
			'HTTP-Referer': 'https://github.com/MillenniumDawn/MD-VSCode-Utility-Tool',
			'X-Title': 'MD VSCode Utility Tool release',
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(timeoutMs),
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => '');
		const error = new Error(`OpenRouter returned ${response.status}: ${detail.slice(0, 300)}`);
		error.status = response.status;
		throw error;
	}

	return response.json();
}

function messageContent(payload) {
	return payload?.choices?.[0]?.message?.content ?? '';
}

function request(messages, extra) {
	return {
		model: modelName(),
		messages,
		// A changelog that rewords itself on every rerun would be impossible to review, so the two
		// knobs that make the output repeatable are both pinned.
		temperature: 0.2,
		seed: 7,
		max_tokens: 2000,
		...extra,
	};
}

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// One retry, because a free model is rate limited and a release lands several bullets at once.
async function withRateLimitRetry(call) {
	try {
		return await call();
	} catch (error) {
		if (error?.status !== 429) {
			throw error;
		}
		await wait(20000);
		return call();
	}
}

function describe(entry) {
	const lines = [`Pull request #${entry.number}`, `Title: ${entry.title}`];
	if (entry.component) {
		lines.push(`Area: ${entry.component}`);
	}
	lines.push(`Kind: ${entry.section === 'Bugfixes' ? 'bug fix' : 'new or changed behaviour'}`);
	const body = String(entry.body ?? '').replace(/\r/g, '').trim();
	if (body) {
		// Enough for the model to see what the change was without paying for a whole diff discussion.
		lines.push('Description:', body.slice(0, 4000));
	}
	return lines.join('\n');
}

// Tier one: every bullet in one request, held to a schema.
async function rewriteTogether(entries, key) {
	const payload = await withRateLimitRetry(() => post('/chat/completions', request(
		[
			{ role: 'system', content: style },
			{
				role: 'user',
				content: `Rewrite each of these ${entries.length} entries. Return one object per entry, keyed by its pull request number.\n\n`
					+ entries.map(describe).join('\n\n---\n\n'),
			},
		],
		{
			response_format: {
				type: 'json_schema',
				json_schema: {
					name: 'changelog_bullets',
					strict: true,
					schema: {
						type: 'object',
						properties: {
							bullets: {
								type: 'array',
								items: {
									type: 'object',
									properties: {
										number: { type: 'integer' },
										text: { type: 'string' },
									},
									required: ['number', 'text'],
									additionalProperties: false,
								},
							},
						},
						required: ['bullets'],
						additionalProperties: false,
					},
				},
			},
		}), key));

	const content = messageContent(payload);
	const fenced = /```(?:json)?\s*\n([\s\S]*?)\n?```/.exec(content);
	const parsed = JSON.parse(fenced ? fenced[1] : content);
	const written = new Map();
	for (const item of parsed?.bullets ?? []) {
		if (acceptable(item?.text)) {
			written.set(Number(item.number), String(item.text).trim());
		}
	}
	return written;
}

// Tier two: whatever tier one did not produce, one request at a time.
async function rewriteOne(entry, key) {
	const payload = await withRateLimitRetry(() => post('/chat/completions', request([
		{ role: 'system', content: style },
		{ role: 'user', content: `Rewrite this entry as one changelog sentence. Reply with the sentence and nothing else.\n\n${describe(entry)}` },
	]), key));

	const text = cleanReply(messageContent(payload));
	return acceptable(text) ? text : undefined;
}

async function rewrite(entries, key) {
	const written = new Map();
	if (entries.length === 0) {
		return written;
	}

	try {
		for (const [number, text] of await rewriteTogether(entries, key)) {
			written.set(number, text);
		}
	} catch (error) {
		warn(`Could not rewrite the changelog bullets in one request (${error?.message ?? error}); trying them one at a time.`);
	}

	for (const entry of entries) {
		if (written.has(entry.number)) {
			continue;
		}
		try {
			const text = await rewriteOne(entry, key);
			if (text) {
				written.set(entry.number, text);
			} else {
				warn(`The model's reply for pull request #${entry.number} was not usable; keeping its title.`);
			}
		} catch (error) {
			warn(`Could not rewrite the bullet for pull request #${entry.number} (${error?.message ?? error}); keeping its title.`);
		}
	}

	return written;
}

// Says whether the key works at all, so a rejected or exhausted one is visible in the log instead
// of looking exactly like a release whose bullets happened not to need rewriting. Never prints the
// key itself.
async function check(key) {
	if (!key) {
		notice('No OPENROUTER_API_KEY is set, so changelog bullets keep their pull request titles.');
		return false;
	}

	try {
		const response = await fetch(`${endpoint}/key`, {
			headers: { Authorization: `Bearer ${key}` },
			signal: AbortSignal.timeout(30000),
		});
		if (!response.ok) {
			warn(`OpenRouter rejected the key with ${response.status}. Changelog bullets keep their pull request titles.`);
			return false;
		}
		const data = (await response.json())?.data ?? {};
		const limit = data.limit === null || data.limit === undefined ? 'no limit' : `limit ${data.limit}`;
		notice(`OpenRouter key "${data.label ?? 'unnamed'}" accepted (${limit}, used ${data.usage ?? 0}). Model: ${modelName()}.`);
		return true;
	} catch (error) {
		warn(`Could not reach OpenRouter to check the key (${error?.message ?? error}).`);
		return false;
	}
}

function parseArgs(argv) {
	const options = { file: '', check: false };
	for (let i = 0; i < argv.length; i++) {
		const value = argv[i + 1];
		switch (argv[i]) {
			case '--bullets-file':
				options.file = value;
				i++;
				break;
			case '--check':
				options.check = true;
				break;
			default:
				break;
		}
	}
	return options;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const key = process.env.OPENROUTER_API_KEY?.trim() ?? '';

	if (options.check) {
		await check(key);
		return;
	}

	if (!options.file || !fs.existsSync(options.file)) {
		return;
	}

	const found = JSON.parse(fs.readFileSync(options.file, 'utf8'));
	const entries = Array.isArray(found?.entries) ? found.entries : [];
	if (entries.length === 0 || !key) {
		return;
	}

	if (entries.length > maxBullets) {
		warn(`${entries.length} bullets is more than one release should carry; only the first ${maxBullets} are rewritten.`);
	}

	const written = await rewrite(entries.slice(0, maxBullets), key);
	if (written.size === 0) {
		return;
	}

	// bullets[i] belongs to pullRequests[i] and to entries[i]; anything past the end of entries came
	// from a commit with no pull request behind it and is left alone.
	found.bullets = found.bullets.map((bullet, index) => {
		const entry = entries[index];
		const text = entry ? written.get(entry.number) : undefined;
		return text ? assemble(text, entry) : bullet;
	});

	fs.writeFileSync(options.file, `${JSON.stringify(found, undefined, '\t')}\n`);
	notice(`Rewrote ${written.size} of ${entries.length} changelog bullet(s) with ${modelName()}.`);
}

if (require.main === module) {
	main().catch((error) => {
		// Anything that got this far is a bug in this script rather than a failed request, but the
		// release pull request still matters more than the wording of its bullets.
		warn(`Changelog rewriting failed outright (${error?.message ?? error}); the seeded bullets are unchanged.`);
	});
}

module.exports = { acceptable, assemble, check, cleanReply, describe, parseArgs, rewrite, style };
