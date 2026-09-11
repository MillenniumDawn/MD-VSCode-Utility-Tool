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
            assert.strictEqual(usesIn(workflow, 'release-marketplace', 'HaaLeo/publish-vscode-extension'), undefined);
            assert.strictEqual(runsIn(workflow, 'release-open-vsx', 'vsce publish'), undefined);
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
            assert.match(runsIn(workflow, 'pre-release-marketplace', 'scripts/publish-marketplace.js')?.run ?? '', /--pre-release/);
            assert.strictEqual(
                usesIn(workflow, 'pre-release-github', 'softprops/action-gh-release')?.with?.prerelease, true);

            // The release goes out as a release: no --pre-release anywhere on that side.
            assert.doesNotMatch(runsIn(workflow, 'release-marketplace', 'scripts/publish-marketplace.js')?.run ?? '', /--pre-release/);
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
            // The Marketplace side hands the token to the script, which exits 1 without it.
            for (const job of ['pre-release-marketplace', 'release-marketplace']) {
                assert.strictEqual(jobs[job]?.env?.VSCE_PAT, '${{ secrets.VSCE_PAT }}');
                const publish = runsIn(workflow, job, 'scripts/publish-marketplace.js');
                assert.ok(publish, `${job} does not publish through the script`);
                assert.strictEqual(publish?.if, undefined, `${job} still skips itself when VSCE_PAT is missing`);
            }
            for (const job of ['pre-release-open-vsx', 'release-open-vsx']) {
                assert.strictEqual(jobs[job]?.env?.OPEN_VSX_TOKEN, '${{ secrets.OPEN_VSX_TOKEN }}');
                assert.strictEqual(
                    usesIn(workflow, job, 'HaaLeo/publish-vscode-extension')?.if, undefined,
                    `${job} still skips itself when OPEN_VSX_TOKEN is missing`);
                assert.match(runsIn(workflow, job, '-z "$OPEN_VSX_TOKEN"')?.run ?? '', /exit 1/);
            }
        });

        it('hands Open VSX the VSIX that was built, not a directory to build again', function () {
            // packagePath is a directory the action packages itself; pointing it at a .vsix made it
            // read <file>.vsix/package.json and fail.
            for (const job of ['pre-release-open-vsx', 'release-open-vsx']) {
                const openVsx = usesIn(workflow, job, 'HaaLeo/publish-vscode-extension');
                assert.ok(openVsx?.with?.extensionFile, `${job}: Open VSX needs extensionFile`);
                assert.strictEqual(openVsx?.with?.packagePath, undefined);
            }
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

        it('opens a draft pull request on a branch when a release fails', function () {
            const failed = jobs['release-failed'];
            assert.ok(failed, 'nothing reacts to a failed release');

            const watched = [failed.needs ?? []].flat();
            for (const job of ['check', 'verify', 'build-release', ...releaseTargets]) {
                assert.ok(watched.includes(job), `release-failed does not watch ${job}`);
            }
            // A pre-release runs on every push and the next one supersedes it, so it stays out. So
            // does the release pull request: it is skipped on a release push, and a failure there
            // is not a failed publish.
            for (const job of [...preReleaseTargets, 'release-pull-request']) {
                assert.ok(!watched.includes(job), `release-failed should not watch ${job}`);
            }

            assert.match(failed.if ?? '', /always\(\)/);
            assert.match(failed.if ?? '', /'failure'/);
            // Never on a run someone stopped by hand -- that is not a problem to fix.
            assert.doesNotMatch(failed.if ?? '', /cancelled/);

            const open = runsIn(workflow, 'release-failed', 'gh pr create');
            assert.match(open?.run ?? '', /--draft/);
            // One empty commit, so there is nothing to delete before the fix can merge.
            assert.match(open?.run ?? '', /commit --allow-empty/);
        });

        it('lets the merge of the fix pull request publish the same version again', function () {
            // Merging fix/release-v<version> is the release, and the tag and some of the targets
            // may already be there from the failed run. Each target has to read "already
            // published" as done, or the fix would fail on what did not fail the first time.
            assert.strictEqual(
                usesIn(workflow, 'release-open-vsx', 'HaaLeo/publish-vscode-extension')?.with?.skipDuplicate, true);
            const publish = fs.readFileSync(path.join(workflowDir, '..', '..', 'scripts', 'publish-marketplace.js'), 'utf8');
            assert.match(publish, /--skip-duplicate/);
            // And the pull request says so, instead of sending the fixer to a release pull request.
            const summary = runsIn(workflow, 'release-failed', 'Publishing **$TAG** failed');
            assert.match(summary?.run ?? '', /merge publishes \$TAG again/);
            assert.doesNotMatch(summary?.run ?? '', /release pull request after it/);
        });
    });
});
