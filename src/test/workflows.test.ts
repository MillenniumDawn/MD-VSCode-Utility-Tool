import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// The workflows are the only part of the release machinery with no unit test behind it -- what they
// do only happens on GitHub. These are the properties that would be silently wrong rather than
// loudly broken: an unpinned action, a publish step that runs without its token, a pre-release build
// that forgets it is one.

const workflowDir = path.join(__dirname, '..', '..', '..', '.github', 'workflows');

interface Step {
    id?: string;
    name?: string;
    uses?: string;
    run?: string;
    if?: string;
    with?: Record<string, unknown>;
}

interface Job {
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

function stepUsing(workflow: Workflow, action: string): Step | undefined {
    return steps(workflow).find((step) => step.uses?.startsWith(`${action}@`));
}

describe('.github/workflows', function () {
    it('parses every workflow', function () {
        const files = workflowFiles();
        assert.ok(files.length >= 6, `expected the workflows to still be there, found ${files.length}`);
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

    describe('pre-release.yml', function () {
        const workflow = load('pre-release.yml');
        const publish = workflow.jobs?.publish;

        it('runs on every push to main, and on demand', function () {
            const on = triggers(workflow);
            assert.deepStrictEqual((on.push as { branches: string[] }).branches, ['main']);
            assert.ok('workflow_dispatch' in on);
        });

        it('cancels a build the next push has already superseded', function () {
            assert.strictEqual(workflow.concurrency?.group, 'pre-release');
            assert.strictEqual(workflow.concurrency?.['cancel-in-progress'], true);
        });

        it('packages and publishes as a pre-release, not as a release', function () {
            const packaged = steps(workflow).find((step) => step.run?.includes('package:pre-release'));
            assert.ok(packaged, 'nothing packages the VSIX with --pre-release');

            const marketplace = steps(workflow).find((step) => step.run?.includes('vsce publish'));
            assert.match(marketplace?.run ?? '', /--pre-release/);

            assert.strictEqual(stepUsing(workflow, 'softprops/action-gh-release')?.with?.prerelease, true);
        });

        it('takes the version from the script rather than from package.json', function () {
            const resolve = steps(workflow).find((step) => step.run?.includes('scripts/prerelease-version.js'));
            assert.strictEqual(resolve?.id, 'version');
            assert.match(resolve?.run ?? '', /--apply/);
        });

        it('skips a registry it has no token for instead of failing', function () {
            assert.strictEqual(publish?.env?.VSCE_PAT, '${{ secrets.VSCE_PAT }}');
            assert.strictEqual(publish?.env?.OPEN_VSX_TOKEN, '${{ secrets.OPEN_VSX_TOKEN }}');

            const marketplace = steps(workflow).find((step) => step.run?.includes('vsce publish'));
            assert.match(marketplace?.if ?? '', /env\.VSCE_PAT != ''/);
            assert.match(
                stepUsing(workflow, 'HaaLeo/publish-vscode-extension')?.if ?? '',
                /env\.OPEN_VSX_TOKEN != ''/);
        });

        it('hands Open VSX the VSIX that was built, not a directory to build again', function () {
            const openVsx = stepUsing(workflow, 'HaaLeo/publish-vscode-extension');
            assert.ok(openVsx?.with?.extensionFile, 'Open VSX needs extensionFile');
            assert.strictEqual(openVsx?.with?.packagePath, undefined);
        });
    });

    describe('release.yml', function () {
        it('hands Open VSX the VSIX that was built, not a directory to build again', function () {
            // packagePath is a directory the action packages itself; pointing it at a .vsix made it
            // read <file>.vsix/package.json and fail.
            const openVsx = stepUsing(load('release.yml'), 'HaaLeo/publish-vscode-extension');
            assert.ok(openVsx?.with?.extensionFile, 'Open VSX needs extensionFile');
            assert.strictEqual(openVsx?.with?.packagePath, undefined);
        });
    });
});
