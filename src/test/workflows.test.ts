import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// The workflows are the only part of the release machinery with no unit test behind it -- what they
// do only happens on GitHub. These are the properties that would be silently wrong rather than
// loudly broken: an unpinned action, a publish step that skips itself for want of a token, a
// pre-release build that forgets it is one.

const workflowDir = path.join(__dirname, '..', '..', '..', '.github', 'workflows');

interface Step {
    id?: string;
    name?: string;
    uses?: string;
    run?: string;
    if?: string;
    with?: Record<string, unknown>;
    env?: Record<string, string>;
}

interface Job {
    name?: string;
    needs?: string | string[];
    if?: string;
    steps?: Step[];
    concurrency?: unknown;
    permissions?: unknown;
    env?: Record<string, string>;
    outputs?: Record<string, string>;
    'timeout-minutes'?: number;
}

interface Workflow {
    on?: Record<string, unknown>;
    name?: string;
    concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
    jobs?: Record<string, Job>;
}

function workflowFiles(): string[] {
    return fs.readdirSync(workflowDir).filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'));
}

function load(file: string): Workflow {
    return yaml.load(fs.readFileSync(path.join(workflowDir, file), 'utf8')) as Workflow;
}

// `on` is a boolean in YAML 1.1 and a plain string in 1.2, and which one a parser believes decides
// whether the trigger block comes back under "on" or under "true". Ask for both rather than depend
// on the schema whichever js-yaml is installed happens to use.
function triggers(workflow: Workflow): Record<string, unknown> {
    return (workflow.on ?? (workflow as unknown as Record<string, unknown>)['true'] ?? {}) as Record<string, unknown>;
}

function steps(workflow: Workflow): Step[] {
    return Object.values(workflow.jobs ?? {}).flatMap((job) => job.steps ?? []);
}

function jobSteps(workflow: Workflow, job: string): Step[] {
    return workflow.jobs?.[job]?.steps ?? [];
}

function usesIn(workflow: Workflow, job: string, action: string): Step | undefined {
    return jobSteps(workflow, job).find((step) => step.uses?.startsWith(`${action}@`));
}

function runsIn(workflow: Workflow, job: string, fragment: string): Step | undefined {
    return jobSteps(workflow, job).find((step) => step.run?.includes(fragment));
}

// A step runs Node when a line of its script starts with node, npm or npx, or pipes into or
// substitutes one -- not when it only names them in a message it echoes.
function runsNode(step: Step): boolean {
    return (step.run ?? '').split('\n').some((line) => {
        const trimmed = line.trim();
        return !trimmed.startsWith('echo ') && !trimmed.startsWith('#') && /(^|[\s(|])(node|npm|npx)\s/.test(trimmed);
    });
}

describe('.github/workflows', function () {
    it('parses every workflow', function () {
        const files = workflowFiles();
        assert.ok(files.length >= 5, `expected the workflows to still be there, found ${files.length}`);
        for (const file of files) {
            assert.ok(load(file)?.jobs, `${file} has no jobs`);
        }
    });

    it('pins every action to a commit, never to a tag someone else can move', function () {
        for (const file of workflowFiles()) {
            for (const step of steps(load(file))) {
                if (!step.uses || step.uses.startsWith('./')) {
                    continue;
                }
                assert.match(step.uses, /^[\w-]+\/[\w.-]+@[0-9a-f]{40}$/, `${file}: ${step.uses}`);
            }
        }
    });

    it('sets up the pinned Node before any job runs it', function () {
        // The check and release pull request jobs used to run release-check.js and the bump
        // scripts on whatever Node the runner image shipped, which GitHub rolls forward without
        // notice, while the tests pinned theirs. Every job that runs node now sets it up first, and
        // every setup reads the one declaration in .nvmrc rather than carrying its own number.
        for (const file of workflowFiles()) {
            for (const [id, job] of Object.entries(load(file).jobs ?? {})) {
                let setUp = false;
                for (const step of job.steps ?? []) {
                    if (step.uses?.startsWith('actions/setup-node@')) {
                        assert.strictEqual(step.with?.['node-version-file'], '.nvmrc', `${file}: ${id} does not read .nvmrc`);
                        assert.strictEqual(step.with?.['node-version'], undefined, `${file}: ${id} pins its own Node version`);
                        setUp = true;
                    }
                    if (runsNode(step)) {
                        assert.ok(setUp, `${file}: ${id} runs node in "${step.name ?? step.run}" without setting it up`);
                    }
                }
            }
        }
    });

    it('gives every job a time limit', function () {
        // None had one, so each inherited GitHub's six-hour default. release.yml never cancels a
        // run, so one stuck publish would have parked every later release for that long.
        // The patient Open VSX retry is the one job whose work is the waiting: five, ten and
        // fifteen minutes between attempts, so its limit has to hold that half hour plus the
        // attempts themselves.
        const allowed = (id: string) => (id === 'release-open-vsx-retry' ? 45 : 30);
        for (const file of workflowFiles()) {
            for (const [id, job] of Object.entries(load(file).jobs ?? {})) {
                const limit = (job as Record<string, unknown>)['timeout-minutes'];
                assert.strictEqual(typeof limit, 'number', `${file}: ${id} has no timeout-minutes`);
                assert.ok((limit as number) > 0 && (limit as number) <= allowed(id), `${file}: ${id} allows ${limit} minutes`);
            }
        }
    });

    it('names the token scope every job runs with', function () {
        // Every workflow runs npm lifecycle scripts or gh over branch code; the default token scope
        // is whatever the repository settings say, which is not something a reviewer can see here.
        for (const file of workflowFiles()) {
            const workflow = load(file) as Workflow & { permissions?: unknown };
            if (workflow.permissions !== undefined) {
                continue;
            }
            for (const [id, job] of Object.entries(workflow.jobs ?? {})) {
                assert.ok(job.permissions !== undefined, `${file}: ${id} runs with the default token scope`);
            }
        }
    });

    it('runs on a pull request whatever branch it targets', function () {
        // `branches: "*"` names the base branch, and "*" does not match a "/" -- a pull request into
        // release/version-bump or feature/x used to trigger nothing.
        for (const file of workflowFiles()) {
            const on = triggers(load(file));
            const pullRequest = on.pull_request as Record<string, unknown> | null | undefined;
            if (pullRequest === undefined) {
                continue;
            }
            assert.strictEqual(pullRequest?.branches, undefined, `${file}: pull_request carries a branches filter`);
            assert.strictEqual(pullRequest?.['branches-ignore'], undefined, `${file}: pull_request carries a branches-ignore filter`);
        }
    });

    it('never force-pushes over a commit it has not seen', function () {
        for (const file of workflowFiles()) {
            for (const step of steps(load(file))) {
                for (const line of (step.run ?? '').split('\n')) {
                    if (/git push\b/.test(line) && /--force\b/.test(line)) {
                        assert.match(line, /--force-with-lease/, `${file}: "${line.trim()}" would discard a push that landed since the checkout`);
                    }
                }
            }
        }
    });

    it('declares the Node version once and keeps the types on it', function () {
        const root = path.join(workflowDir, '..', '..');
        const major = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim();
        assert.match(major, /^\d+$/, '.nvmrc should carry a bare major version');
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
            engines?: Record<string, string>;
            devDependencies?: Record<string, string>;
        };
        assert.strictEqual(pkg.engines?.node, `>=${major}`);
        assert.strictEqual(pkg.devDependencies?.['@types/node'], `^${major}`);
    });

    describe('release.yml', function () {
        const workflow = load('release.yml');
        const jobs = workflow.jobs ?? {};

        const preReleaseTargets = ['pre-release-marketplace', 'pre-release-open-vsx', 'pre-release-github'];
        const releaseTargets = ['release-marketplace', 'release-open-vsx', 'release-github'];

        it('does everything a push to main leads to from one run', function () {
            // The pre-release and the release pull request each used to be a workflow of their own,
            // starting from the same release-check.js decision the publish made separately.
            for (const file of ['pre-release.yml', 'version-bump.yml']) {
                assert.ok(!workflowFiles().includes(file), `${file} is back; a push to main should be one run, not two`);
            }
            for (const job of ['check', 'verify', 'release-pull-request', 'build-pre-release', 'build-release', ...preReleaseTargets, ...releaseTargets]) {
                assert.ok(jobs[job], `${job} is missing`);
            }
        });

        it('runs on every push to main, and on demand with a bump size', function () {
            const on = triggers(workflow);
            assert.deepStrictEqual((on.push as { branches: string[] }).branches, ['main']);
            const dispatch = on.workflow_dispatch as { inputs?: Record<string, { options?: string[]; default?: string }> };
            assert.ok(dispatch, 'no workflow_dispatch trigger');
            assert.deepStrictEqual(dispatch.inputs?.release_type?.options, ['patch', 'minor', 'major']);
            assert.strictEqual(dispatch.inputs?.release_type?.default, 'patch');
        });

        it('opens the release pull request from the same decision as the publish', function () {
            const job = jobs['release-pull-request'];
            assert.ok([job?.needs ?? []].flat().includes('check'), 'the release pull request does not wait for check');
            assert.match(job?.if ?? '', /needs\.check\.outputs\.bump == 'true'/);
            // The decision is made once, in check; asking again here is how two answers drift apart.
            assert.strictEqual(runsIn(workflow, 'release-pull-request', 'scripts/release-check.js'), undefined);
            for (const step of jobSteps(workflow, 'release-pull-request')) {
                for (const value of [step.if ?? '', step.run ?? '', ...Object.values(step.with ?? {}), ...Object.values(step.env ?? {})]) {
                    assert.doesNotMatch(String(value), /steps\.state\.outputs/, `${step.name} still reads the old in-job decision`);
                }
            }
            const open = runsIn(workflow, 'release-pull-request', 'gh pr create');
            assert.match(open?.run ?? '', /--head "\$RELEASE_BRANCH"/);
            assert.strictEqual(job?.env?.RELEASE_BRANCH, 'release/version-bump');
            assert.match(job?.env?.RELEASE_TYPE ?? '', /inputs\.release_type/);
            // The release pull request is what the bot pushes; a run that is not a release must never
            // reach the publish targets through it.
            assert.strictEqual(runsIn(workflow, 'release-pull-request', 'vsce publish'), undefined);
        });

        it('never cancels a run that may already be halfway through publishing', function () {
            assert.strictEqual(workflow.concurrency?.group, 'publish');
            assert.strictEqual(workflow.concurrency?.['cancel-in-progress'], false);
        });

        it('gives every publish target its own job, so a failing registry costs only itself', function () {
            for (const job of [...preReleaseTargets, ...releaseTargets]) {
                assert.ok(jobs[job]?.name, `${job} has no name to show in the Actions graph`);
            }
            // One registry must never be reachable only through the other.
            assert.doesNotMatch(runsIn(workflow, 'release-marketplace', 'scripts/publish-extension.js')?.run ?? '', /open-vsx/);
            assert.doesNotMatch(runsIn(workflow, 'release-open-vsx', 'scripts/publish-extension.js')?.run ?? '', /marketplace/);
            // The publish action made one request and died on a 503; the script retries.
            for (const job of Object.keys(jobs)) {
                assert.strictEqual(usesIn(workflow, job, 'HaaLeo/publish-vscode-extension'), undefined, `${job} still publishes through the action`);
            }
        });

        it('builds beside the tests and publishes only after both', function () {
            // The build used to queue behind `verify` although neither reads the other's output;
            // now they run side by side and the publish jobs wait for both.
            for (const build of ['build-pre-release', 'build-release']) {
                const needs = [jobs[build]?.needs ?? []].flat();
                assert.ok(needs.includes('check'), `${build} does not wait for check`);
                assert.ok(!needs.includes('verify'), `${build} still queues behind verify`);
            }
            for (const [target, build] of [
                ...preReleaseTargets.map((target) => [target, 'build-pre-release']),
                ...releaseTargets.map((target) => [target, 'build-release']),
            ]) {
                const needs = [jobs[target]?.needs ?? []].flat();
                assert.ok(needs.includes(build), `${target} does not wait for ${build}`);
                assert.ok(needs.includes('verify'), `${target} could publish a build the tests failed`);
            }
        });

        it('takes main\'s package.json when the catch-up merge conflicts on it', function () {
            // `--ours` on package.json kept the release branch's copy wholesale, which quietly
            // reverted whatever a branch on main had added to it; only the version is this
            // branch's to keep, and merge-changelog.js writes that back.
            const refresh = runsIn(workflow, 'release-pull-request', 'git merge --no-edit origin/main');
            assert.ok(refresh, 'no catch-up merge step');
            assert.doesNotMatch(refresh.run ?? '', /git checkout --ours -- \$conflicts/);
            assert.match(refresh.run ?? '', /git checkout --theirs -- "\$conflict"/);
            assert.match(refresh.run ?? '', /merge-changelog\.js --theirs .* --version "\$higher"/);
        });

        it('skips the pre-release on the push that is a release', function () {
            // The release commit carries a version and a changelog and nothing else, so publishing it
            // to the pre-release channel as well would ship the same code twice.
            assert.match(jobs['build-pre-release']?.if ?? '', /needs\.check\.outputs\.release != 'true'/);
            assert.match(jobs['build-release']?.if ?? '', /needs\.check\.outputs\.release == 'true'/);
        });

        it('packages and publishes the pre-release as a pre-release, not as a release', function () {
            assert.ok(
                runsIn(workflow, 'build-pre-release', 'package:pre-release'),
                'nothing packages the VSIX with --pre-release');
            assert.match(runsIn(workflow, 'pre-release-marketplace', 'scripts/publish-extension.js')?.run ?? '', /--pre-release/);
            assert.strictEqual(
                usesIn(workflow, 'pre-release-github', 'softprops/action-gh-release')?.with?.prerelease, true);
            // Not Open VSX: ovsx ignores --pre-release for a built .vsix and reads the manifest.
            assert.doesNotMatch(runsIn(workflow, 'pre-release-open-vsx', 'scripts/publish-extension.js')?.run ?? '', /--pre-release/);

            // The release goes out as a release: no --pre-release anywhere on that side.
            assert.doesNotMatch(runsIn(workflow, 'release-marketplace', 'scripts/publish-extension.js')?.run ?? '', /--pre-release/);
            assert.strictEqual(
                usesIn(workflow, 'release-github', 'softprops/action-gh-release')?.with?.prerelease, undefined);
        });

        it('takes the pre-release version from the script rather than from package.json', function () {
            const resolve = runsIn(workflow, 'build-pre-release', 'scripts/prerelease-version.js');
            assert.strictEqual(resolve?.id, 'version');
            assert.match(resolve?.run ?? '', /--apply/);
        });

        it('fails when a registry token is missing instead of skipping and reporting success', function () {
            // A missing OPEN_VSX_TOKEN used to skip the publish step and leave the job green, which is
            // how the extension reached no one on Open VSX for months while every run said success.
            // Both sides hand the token to the script, which exits 1 without it.
            const registries: [string[], string, string][] = [
                [['pre-release-marketplace', 'release-marketplace'], 'VSCE_PAT', 'marketplace'],
                [['pre-release-open-vsx', 'release-open-vsx', 'release-open-vsx-retry'], 'OPEN_VSX_TOKEN', 'open-vsx'],
            ];
            for (const [targets, token, registry] of registries) {
                for (const job of targets) {
                    assert.strictEqual(jobs[job]?.env?.[token], `\${{ secrets.${token} }}`);
                    const publish = runsIn(workflow, job, 'scripts/publish-extension.js');
                    assert.ok(publish, `${job} does not publish through the script`);
                    assert.match(publish?.run ?? '', new RegExp(`--registry ${registry}\\b`));
                    assert.strictEqual(publish?.if, undefined, `${job} still skips itself when ${token} is missing`);
                    // The script runs vsce and ovsx with --no-install, out of the dev dependencies.
                    assert.ok(runsIn(workflow, job, 'npm ci'), `${job} publishes without installing the registry client`);
                }
            }
        });

        it('hands both registries the VSIX that was built, out of the artifact', function () {
            const chains: [string, string[]][] = [
                ['build-pre-release', ['pre-release-marketplace', 'pre-release-open-vsx']],
                ['build-release', ['release-marketplace', 'release-open-vsx', 'release-open-vsx-retry']],
            ];
            for (const [build, targets] of chains) {
                for (const job of targets) {
                    assert.strictEqual(jobs[job]?.env?.VSIX, `\${{ needs.${build}.outputs.vsix }}`, `${job} does not take the VSIX from ${build}`);
                    assert.match(runsIn(workflow, job, 'scripts/publish-extension.js')?.run ?? '', /--vsix "\$VSIX"/);
                }
            }
        });

        it('tries Open VSX again later when the first job gave up on an outage, and only then', function () {
            // v1.1.36 failed to publish on nothing but a 503 from Open VSX, and a fix pull request
            // was opened for a build with nothing wrong with it. The first job says whether its
            // failure looked transient; the retry job runs on that, waits, and asks again.
            const first = jobs['release-open-vsx'];
            assert.strictEqual(first?.outputs?.transient, '${{ steps.publish.outputs.transient }}');
            assert.strictEqual(runsIn(workflow, 'release-open-vsx', 'scripts/publish-extension.js')?.id, 'publish');
            assert.doesNotMatch(runsIn(workflow, 'release-open-vsx', 'scripts/publish-extension.js')?.run ?? '', /--schedule/);

            const retry = jobs['release-open-vsx-retry'];
            assert.ok(retry, 'no retry job for Open VSX');
            assert.ok([retry.needs ?? []].flat().includes('release-open-vsx'));
            assert.match(retry.if ?? '', /always\(\)/);
            assert.match(retry.if ?? '', /needs\['release-open-vsx'\]\.result == 'failure'/);
            assert.match(retry.if ?? '', /needs\['release-open-vsx'\]\.outputs\.transient == 'true'/);
            assert.match(runsIn(workflow, 'release-open-vsx-retry', 'scripts/publish-extension.js')?.run ?? '', /--schedule patient/);
            // Three waits of up to fifteen minutes, and a ceiling so a hung registry cannot hold the
            // publish concurrency group for the six hours a job is allowed.
            assert.ok(typeof retry['timeout-minutes'] === 'number' && retry['timeout-minutes'] <= 60, 'the retry job has no sensible timeout');
            // A pre-release is superseded by the next push, so it gets no second job.
            assert.strictEqual(jobs['pre-release-open-vsx-retry'], undefined);
        });

        it('gives all three targets the same bytes, through an artifact', function () {
            const chains: [string, string, string[]][] = [
                ['build-pre-release', 'pre-release-vsix', preReleaseTargets],
                ['build-release', 'release-vsix', releaseTargets],
            ];
            for (const [build, artifact, targets] of chains) {
                assert.strictEqual(usesIn(workflow, build, 'actions/upload-artifact')?.with?.name, artifact);
                for (const target of targets) {
                    assert.strictEqual(
                        usesIn(workflow, target, 'actions/download-artifact')?.with?.name, artifact,
                        `${target} does not take the build from ${artifact}`);
                }
            }
        });

        it('creates the GitHub release and its tag only after a registry took the build', function () {
            // The GitHub release is the tag, and the tag is what release-check.js reads as "this
            // version shipped". It used to run beside the registries, so a release both of them
            // rejected still got its tag and the version was burned while nobody could install it.
            const github = jobs['release-github'];
            const needs = [github?.needs ?? []].flat();
            for (const registry of ['release-marketplace', 'release-open-vsx']) {
                assert.ok(needs.includes(registry), `release-github does not wait for ${registry}`);
            }
            // At least one, not both: a single registry outage still costs only that registry.
            assert.match(github?.if ?? '', /needs\.release-marketplace\.result == 'success'/);
            assert.match(github?.if ?? '', /needs\.release-open-vsx\.result == 'success'/);
            assert.match(github?.if ?? '', /\|\|/);
            assert.match(github?.if ?? '', /needs\.build-release\.result == 'success'/);
            // Evaluated even though a needed job failed, but never on a run someone stopped.
            assert.match(github?.if ?? '', /!cancelled\(\)/);
            assert.doesNotMatch(github?.if ?? '', /always\(\)/);

            // A pre-release is superseded by the next push and has no fix branch, so its GitHub
            // prerelease stays independent of the registries. It still waits for verify, like
            // every other target, so a build that fails lint or the unit tests publishes nothing.
            assert.deepStrictEqual(
                [jobs['pre-release-github']?.needs ?? []].flat(),
                ['build-pre-release', 'verify'],
            );

            // The fix pull request lists the skipped GitHub release: that line is what says there
            // is no tag.
            const summary = runsIn(workflow, 'release-failed', 'Publishing **$TAG** failed');
            assert.match(summary?.run ?? '', /startswith\("Release:"\)/);
        });

        it('opens a draft pull request on a branch when a release fails', function () {
            const failed = jobs['release-failed'];
            assert.ok(failed, 'nothing reacts to a failed release');

            const watched = [failed.needs ?? []].flat();
            for (const job of ['check', 'verify', 'build-release', ...releaseTargets, 'release-open-vsx-retry']) {
                assert.ok(watched.includes(job), `release-failed does not watch ${job}`);
            }
            // A pre-release runs on every push and the next one supersedes it, so it stays out. So
            // does the release pull request: it is skipped on a release push, and a failure there
            // is not a failed publish.
            for (const job of [...preReleaseTargets, 'release-pull-request']) {
                assert.ok(!watched.includes(job), `release-failed should not watch ${job}`);
            }

            // Evaluated even though a needed job failed, but never on a run someone stopped by
            // hand -- that is not a problem to fix. `always()` is also true on a cancelled run,
            // and a retry cancelled mid-wait would then read as "not success" and open a pull
            // request for the first Open VSX failure.
            assert.match(failed.if ?? '', /!cancelled\(\)/);
            assert.doesNotMatch(failed.if ?? '', /always\(\)/);
            // Every job whose failure is a failed release, by name: the old `contains(join(...))`
            // over every result would have opened a pull request for the Open VSX job that only
            // handed over to the retry.
            for (const job of ['verify', 'build-release', 'release-marketplace', 'release-github', 'release-open-vsx-retry']) {
                assert.match(failed.if ?? '', new RegExp(`needs(?:\\.|\\[')${job}(?:'\\])?\\.result == 'failure'`), `release-failed ignores ${job}`);
            }
            assert.doesNotMatch(failed.if ?? '', /join\(needs/);
            // The first Open VSX failure counts only when the retry did not put it right: it failed
            // too, or was skipped because the failure was never transient.
            assert.match(failed.if ?? '', /needs\['release-open-vsx'\]\.result == 'failure' && needs\['release-open-vsx-retry'\]\.result != 'success'/);
            // Folded into one line, or the runner sees a string rather than an expression.
            assert.doesNotMatch(failed.if ?? '', /\n/);

            const open = runsIn(workflow, 'release-failed', 'gh pr create');
            assert.match(open?.run ?? '', /--draft/);
            // One empty commit, so there is nothing to delete before the fix can merge.
            assert.match(open?.run ?? '', /commit --allow-empty/);
        });

        it('lets the merge of the fix pull request publish the same version again', function () {
            // Merging fix/release-v<version> is the release, and the tag and some of the targets
            // may already be there from the failed run. Each target has to read "already
            // published" as done, or the fix would fail on what did not fail the first time.
            const publish = require(path.join(workflowDir, '..', '..', 'scripts', 'publish-extension.js'));
            for (const registry of ['marketplace', 'open-vsx']) {
                assert.ok(
                    publish.commandFor({ registry, vsix: 'ext.vsix', pat: 'secret', preRelease: false }).includes('--skip-duplicate'),
                    `${registry} fails on a version it already has`);
            }
            // And the pull request says so, instead of sending the fixer to a release pull request.
            const summary = runsIn(workflow, 'release-failed', 'Publishing **$TAG** failed');
            assert.match(summary?.run ?? '', /merge publishes \$TAG again/);
            assert.doesNotMatch(summary?.run ?? '', /release pull request after it/);
        });
    });

    describe('test.yml', function () {
        const workflow = load('test.yml');

        it('gates every pull request on coverage of the lines it changed', function () {
            // The whole-suite c8 thresholds leave room for thousands of untested lines, so the
            // step reading the lcov report is the one that keeps coverage from sliding. It diffs
            // against HEAD^1 -- the base branch, since HEAD is the merge commit on a pull request
            // -- which only exists when the checkout is deeper than the default one commit.
            const gate = runsIn(workflow, 'test', 'scripts/diff-coverage.js');
            assert.ok(gate, 'no changed-lines coverage step');
            assert.match(gate.run ?? '', /--base HEAD\^1/);
            assert.match(gate.if ?? '', /github\.event_name == 'pull_request'/);

            const testSteps = jobSteps(workflow, 'test');
            const coverage = testSteps.findIndex((step) => step.run?.includes('test:coverage'));
            assert.ok(coverage >= 0, 'no coverage step');
            assert.ok(testSteps.indexOf(gate) > coverage, 'the gate runs before the report it reads exists');

            assert.strictEqual(usesIn(workflow, 'test', 'actions/checkout')?.with?.['fetch-depth'], 2);
        });
    });
});
