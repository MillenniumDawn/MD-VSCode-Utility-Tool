import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Plain CommonJS helpers shared by the version-check and version-bump workflows. They deliberately
// live outside src/ so CI can run them without a build, so they are pulled in through require.
const bumpVersion = require('../../../scripts/bump-version');
const checkVersion = require('../../../scripts/check-version');
const releaseCheck = require('../../../scripts/release-check');
const prBullets = require('../../../scripts/pr-bullets');
const changelogBullets = require('../../../scripts/changelog-bullets');
const selectBullets = require('../../../scripts/select-bullets');
const releasePrBody = require('../../../scripts/release-pr-body');
const rewriteBullets = require('../../../scripts/rewrite-bullets');
const mergeChangelog = require('../../../scripts/merge-changelog');

describe('scripts/bump-version', function () {
    describe('nextVersion', function () {
        it('bumps the patch by default', function () {
            assert.strictEqual(bumpVersion.nextVersion('1.1.22'), '1.1.23');
        });

        it('bumps minor and resets patch', function () {
            assert.strictEqual(bumpVersion.nextVersion('1.1.22', 'minor'), '1.2.0');
        });

        it('bumps major and resets the rest', function () {
            assert.strictEqual(bumpVersion.nextVersion('1.1.22', 'major'), '2.0.0');
        });

        it('rejects an unknown release type', function () {
            assert.throws(() => bumpVersion.nextVersion('1.1.22', 'huge'), /Unknown release type/);
        });

        it('rejects a version that is not three plain parts', function () {
            assert.throws(() => bumpVersion.nextVersion('1.1.22-beta'), /three-part version/);
        });
    });

    describe('higherVersion', function () {
        it('keeps the version a release should carry', function () {
            assert.strictEqual(bumpVersion.higherVersion('1.1.23', '1.1.24'), '1.1.24');
            assert.strictEqual(bumpVersion.higherVersion('1.1.24', '1.1.23'), '1.1.24');
            assert.strictEqual(bumpVersion.higherVersion('1.2.0', '1.1.99'), '1.2.0');
            assert.strictEqual(bumpVersion.higherVersion('1.1.23', '1.1.23'), '1.1.23');
        });
    });

    describe('topSectionBullets', function () {
        it('reads the bullets of the section on top', function () {
            assert.deepStrictEqual(
                bumpVersion.topSectionBullets('v1.1.24\n\n  Functionality:\n\n- One.\n- Two.\n\nv1.1.23\n\n- Old.\n'),
                ['- One.', '- Two.']);
        });

        it('returns nothing when the changelog does not start with a version', function () {
            assert.deepStrictEqual(bumpVersion.topSectionBullets('Some prose\n\n- Not a section.\n'), []);
            assert.deepStrictEqual(bumpVersion.topSectionBullets(''), []);
        });
    });

    describe('issueFromBody', function () {
        it('reads the GitHub closing keywords', function () {
            assert.strictEqual(bumpVersion.issueFromBody('Closes #42'), 42);
            assert.strictEqual(bumpVersion.issueFromBody('this fixes #7 nicely'), 7);
            assert.strictEqual(bumpVersion.issueFromBody('Resolved #100.'), 100);
        });

        it('takes the first reference when there are several', function () {
            assert.strictEqual(bumpVersion.issueFromBody('Closes #4\nCloses #9'), 4);
        });

        it('ignores a bare issue mention', function () {
            assert.strictEqual(bumpVersion.issueFromBody('see #42 for background'), undefined);
            assert.strictEqual(bumpVersion.issueFromBody(undefined), undefined);
        });
    });

    describe('bulletFor', function () {
        it('adds the missing full stop', function () {
            assert.strictEqual(bumpVersion.bulletFor('Fix the thing'), '- Fix the thing.');
        });

        it('leaves existing punctuation alone', function () {
            assert.strictEqual(bumpVersion.bulletFor('Why is it broken?'), '- Why is it broken?');
        });

        it('appends the issue reference', function () {
            assert.strictEqual(bumpVersion.bulletFor('Fix the thing', 42), '- Fix the thing. Issue #42.');
        });

        it('falls back when there is no title', function () {
            assert.strictEqual(bumpVersion.bulletFor(''), '- Describe this change.');
        });
    });

    describe('prependChangelog', function () {
        it('writes the house style and keeps the old content', function () {
            const result = bumpVersion.prependChangelog('v1.1.22\n\n  Bugfixes:\n\n- Old.\n', '1.1.23', 'New thing', 5);
            assert.strictEqual(
                result,
                'v1.1.23\n\n  Functionality:\n\n- New thing. Issue #5.\n\nv1.1.22\n\n  Bugfixes:\n\n- Old.\n');
        });

        it('handles an empty changelog', function () {
            assert.strictEqual(
                bumpVersion.prependChangelog('', '1.0.0', 'First'),
                'v1.0.0\n\n  Functionality:\n\n- First.\n');
        });

        it('writes one bullet per pull request when given a list', function () {
            assert.strictEqual(
                bumpVersion.prependChangelog('', '1.0.0', ['- First thing.', 'Second thing']),
                'v1.0.0\n\n  Functionality:\n\n- First thing.\n- Second thing.\n');
        });

        it('falls back to a placeholder for an empty list', function () {
            assert.strictEqual(
                bumpVersion.prependChangelog('', '1.0.0', []),
                'v1.0.0\n\n  Functionality:\n\n- Describe this change.\n');
        });
    });

    describe('appendBullets', function () {
        const changelog = 'v1.1.24\n\n  Functionality:\n\n- [ MIO ] Reworded by hand.\n\nv1.1.23\n\n  Bugfixes:\n\n- Old.\n';

        it('adds to the section that is already on top', function () {
            assert.strictEqual(
                bumpVersion.appendBullets(changelog, '1.1.24', ['- Another change.']),
                'v1.1.24\n\n  Functionality:\n\n- [ MIO ] Reworded by hand.\n- Another change.\n' +
                '\nv1.1.23\n\n  Bugfixes:\n\n- Old.\n');
        });

        it('leaves a bullet that is already there', function () {
            assert.strictEqual(
                bumpVersion.appendBullets(changelog, '1.1.24', ['- [ MIO ] Reworded by hand.']),
                changelog);
        });

        it('starts a new section when the top is a different version', function () {
            assert.strictEqual(
                bumpVersion.appendBullets(changelog, '1.1.25', ['- Fresh.']),
                `v1.1.25\n\n  Functionality:\n\n- Fresh.\n\n${changelog}`);
        });

        it('handles an empty changelog', function () {
            assert.strictEqual(
                bumpVersion.appendBullets('', '1.0.0', ['- Only one.']),
                'v1.0.0\n\n  Functionality:\n\n- Only one.\n');
        });

        it('adds no placeholder when there is nothing new', function () {
            assert.strictEqual(bumpVersion.appendBullets(changelog, '1.1.24', []), changelog);
            assert.strictEqual(bumpVersion.appendBullets(changelog, '1.1.24', ['   ']), changelog);
        });

        it('files a bugfix under its own heading, creating it below Functionality', function () {
            assert.strictEqual(
                bumpVersion.appendBullets(changelog, '1.1.24', [{ text: '- A fix.', section: 'Bugfixes' }]),
                'v1.1.24\n\n  Functionality:\n\n- [ MIO ] Reworded by hand.\n\n  Bugfixes:\n\n- A fix.\n' +
                '\nv1.1.23\n\n  Bugfixes:\n\n- Old.\n');
        });

        it('adds to a Bugfixes heading that is already there', function () {
            const withBoth = 'v1.1.24\n\n  Functionality:\n\n- A feature.\n\n  Bugfixes:\n\n- A fix.\n';
            assert.strictEqual(
                bumpVersion.appendBullets(withBoth, '1.1.24', [{ text: '- Another fix.', section: 'Bugfixes' }]),
                'v1.1.24\n\n  Functionality:\n\n- A feature.\n\n  Bugfixes:\n\n- A fix.\n- Another fix.\n');
        });

        it('creates Functionality above a section that only has Bugfixes', function () {
            const onlyBugs = 'v1.1.24\n\n  Bugfixes:\n\n- A fix.\n';
            assert.strictEqual(
                bumpVersion.appendBullets(onlyBugs, '1.1.24', [{ text: '- A feature.', section: 'Functionality' }]),
                'v1.1.24\n\n  Functionality:\n\n- A feature.\n\n  Bugfixes:\n\n- A fix.\n');
        });

        it('splits a mixed batch across both headings in one pass', function () {
            assert.strictEqual(
                bumpVersion.appendBullets('v1.1.24\n\n  Functionality:\n\n- A feature.\n', '1.1.24', [
                    { text: '- Another feature.', section: 'Functionality' },
                    { text: '- A fix.', section: 'Bugfixes' },
                ]),
                'v1.1.24\n\n  Functionality:\n\n- A feature.\n- Another feature.\n\n  Bugfixes:\n\n- A fix.\n');
        });

        it('keeps a section that has no headings at all as it is', function () {
            const bare = 'v1.1.24\n\n- Written by hand.\n';
            assert.strictEqual(
                bumpVersion.appendBullets(bare, '1.1.24', [{ text: '- A fix.', section: 'Bugfixes' }]),
                'v1.1.24\n\n- Written by hand.\n- A fix.\n');
        });
    });

    describe('topSectionEntries', function () {
        it('remembers which heading each bullet sat under', function () {
            assert.deepStrictEqual(
                bumpVersion.topSectionEntries(
                    'v1.1.24\n\n  Functionality:\n\n- One.\n\n  Bugfixes:\n\n- Two.\n\nv1.1.23\n\n- Old.\n'),
                [{ text: '- One.', section: 'Functionality' }, { text: '- Two.', section: 'Bugfixes' }]);
        });

        it('assumes Functionality when a section has no heading', function () {
            assert.deepStrictEqual(
                bumpVersion.topSectionEntries('v1.1.24\n\n- One.\n'),
                [{ text: '- One.', section: 'Functionality' }]);
        });
    });

    describe('combineChangelogs', function () {
        const ours = 'v1.1.24\n\n  Functionality:\n\n- [ Focus Tree ] The red line is gone. Issue #62.\n';

        it('keeps our wording and adds only what main also says', function () {
            const theirs = 'v1.1.24\n\n  Functionality:\n\n- Stop drawing the red line. Issue #62.\n'
                + '\n  Bugfixes:\n\n- Something else entirely.\n';

            assert.strictEqual(
                bumpVersion.combineChangelogs(ours, theirs, '1.1.24'),
                'v1.1.24\n\n  Functionality:\n\n- [ Focus Tree ] The red line is gone. Issue #62.\n'
                + '\n  Bugfixes:\n\n- Something else entirely.\n');
        });

        it('never repeats a change main worded differently', function () {
            const theirs = 'v1.1.24\n\n  Functionality:\n\n- The red line is gone.\n';
            assert.strictEqual(bumpVersion.combineChangelogs(ours, theirs, '1.1.24'), ours);
        });

        it('renames the heading to the version the release goes out as', function () {
            assert.strictEqual(
                bumpVersion.combineChangelogs(ours, '', '1.1.25'),
                ours.replace('v1.1.24', 'v1.1.25'));
        });

        it('takes everything when we have nothing yet', function () {
            assert.strictEqual(
                bumpVersion.combineChangelogs('v1.1.24\n\n  Functionality:\n\n- Ours.\n',
                    'v1.1.24\n\n  Bugfixes:\n\n- Theirs.\n', '1.1.24'),
                'v1.1.24\n\n  Functionality:\n\n- Ours.\n\n  Bugfixes:\n\n- Theirs.\n');
        });
    });

    describe('writeVersion', function () {
        it('replaces only the version and keeps the formatting', function () {
            const source = '{\n\t"name": "x",\n\t"version": "1.1.22",\n\t"other": "1.1.22"\n}\n';
            const result = bumpVersion.writeVersion(source, '1.1.23');
            assert.strictEqual(result, '{\n\t"name": "x",\n\t"version": "1.1.23",\n\t"other": "1.1.22"\n}\n');
        });

        it('reports a package.json with no version field', function () {
            assert.throws(() => bumpVersion.writeVersion('{}', '1.0.0'), /Could not find/);
        });
    });

    describe('applyBump', function () {
        let dir: string;

        beforeEach(function () {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bump-'));
        });

        afterEach(function () {
            fs.rmSync(dir, { recursive: true, force: true });
        });

        it('writes both files and reports the versions', function () {
            fs.writeFileSync(path.join(dir, 'package.json'), '{\n\t"version": "2.3.4"\n}\n');
            fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), 'v2.3.4\n\n  Bugfixes:\n\n- Old.\n');

            const result = bumpVersion.applyBump({ cwd: dir, title: 'Add a toggle', body: 'Closes #12' });

            assert.strictEqual(result.previous, '2.3.4');
            assert.strictEqual(result.next, '2.3.5');
            assert.strictEqual(
                JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, '2.3.5');
            assert.ok(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8')
                .startsWith('v2.3.5\n\n  Functionality:\n\n- Add a toggle. Issue #12.\n'));
        });

        it('creates the changelog when there is none', function () {
            fs.writeFileSync(path.join(dir, 'package.json'), '{\n\t"version": "1.0.0"\n}\n');

            bumpVersion.applyBump({ cwd: dir, releaseType: 'minor', title: 'New preview' });

            assert.strictEqual(
                fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'),
                'v1.1.0\n\n  Functionality:\n\n- New preview.\n');
        });

        it('writes a bullet per pull request when a list is given', function () {
            fs.writeFileSync(path.join(dir, 'package.json'), '{\n\t"version": "1.0.0"\n}\n');

            bumpVersion.applyBump({ cwd: dir, bullets: ['- One. Issue #1.', '- Two.'], title: 'ignored' });

            assert.strictEqual(
                fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'),
                'v1.0.1\n\n  Functionality:\n\n- One. Issue #1.\n- Two.\n');
        });
    });

    describe('appendToChangelog', function () {
        let dir: string;

        beforeEach(function () {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bump-'));
            fs.writeFileSync(path.join(dir, 'package.json'), '{\n\t"version": "1.0.1"\n}\n');
            fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), 'v1.0.1\n\n  Functionality:\n\n- One.\n');
        });

        afterEach(function () {
            fs.rmSync(dir, { recursive: true, force: true });
        });

        it('adds the new bullets and leaves the version alone', function () {
            const result = bumpVersion.appendToChangelog({ cwd: dir, bullets: ['- Two.'] });

            assert.strictEqual(result.version, '1.0.1');
            assert.strictEqual(result.changed, true);
            assert.strictEqual(
                fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'),
                'v1.0.1\n\n  Functionality:\n\n- One.\n- Two.\n');
            assert.strictEqual(
                JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, '1.0.1');
        });

        it('reports that nothing changed when the bullets are already there', function () {
            assert.strictEqual(bumpVersion.appendToChangelog({ cwd: dir, bullets: ['- One.'] }).changed, false);
        });
    });

    describe('setVersion', function () {
        let dir: string;

        beforeEach(function () {
            dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bump-'));
            fs.writeFileSync(path.join(dir, 'package.json'), '{\n\t"version": "1.1.23"\n}\n');
            fs.writeFileSync(path.join(dir, 'CHANGELOG.md'),
                'v1.1.23\n\n  Functionality:\n\n- Collected.\n\nv1.1.22\n\n  Bugfixes:\n\n- Shipped.\n');
        });

        afterEach(function () {
            fs.rmSync(dir, { recursive: true, force: true });
        });

        it('moves the version and its changelog heading together', function () {
            const result = bumpVersion.setVersion({ cwd: dir, version: '1.1.24' });

            assert.deepStrictEqual(
                { previous: result.previous, version: result.version, renamed: result.renamed, changed: result.changed },
                { previous: '1.1.23', version: '1.1.24', renamed: true, changed: true });
            assert.strictEqual(
                JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, '1.1.24');
            assert.strictEqual(
                fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'),
                'v1.1.24\n\n  Functionality:\n\n- Collected.\n\nv1.1.22\n\n  Bugfixes:\n\n- Shipped.\n');
        });

        it('leaves the released sections below it alone', function () {
            bumpVersion.setVersion({ cwd: dir, version: '2.0.0' });

            assert.ok(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8').includes('v1.1.22\n'));
        });

        it('does nothing when it is already on that version', function () {
            const result = bumpVersion.setVersion({ cwd: dir, version: '1.1.23' });

            assert.strictEqual(result.changed, false);
            assert.strictEqual(result.renamed, false);
        });

        it('rejects a version that is not three plain parts', function () {
            assert.throws(() => bumpVersion.setVersion({ cwd: dir, version: 'latest' }), /three-part version/);
        });
    });

    describe('parseArgs', function () {
        it('reads the flags the workflow passes', function () {
            const options = bumpVersion.parseArgs(['--type', 'minor', '--title', 'A title', '--number', '9']);
            assert.strictEqual(options.releaseType, 'minor');
            assert.strictEqual(options.title, 'A title');
            assert.strictEqual(options.number, '9');
        });

        it('treats a missing body file as an empty body', function () {
            const options = bumpVersion.parseArgs(['--body-file', path.join(os.tmpdir(), 'no-such-file-here')]);
            assert.strictEqual(options.body, '');
        });

        it('reads the version to settle on', function () {
            assert.strictEqual(bumpVersion.parseArgs(['--set-version', '1.1.24']).version, '1.1.24');
        });
    });
});

describe('scripts/check-version', function () {
    describe('isExempt', function () {
        it('exempts documentation and repository tooling', function () {
            for (const file of ['README.md', 'CHANGELOG.md', 'CLAUDE.md', '.github/workflows/test.yml',
                '.claude/skills/fix-issue/SKILL.md', 'LICENSE', '.gitignore', '.vscodeignore']) {
                assert.strictEqual(checkVersion.isExempt(file), true, file);
            }
        });

        it('does not exempt anything that ships in the extension', function () {
            for (const file of ['package.json', 'src/extension.ts', 'webviewsrc/eventtree.ts',
                'resource/eventtree.css', 'i18n/en.ts', 'scripts/bump-version.js']) {
                assert.strictEqual(checkVersion.isExempt(file), false, file);
            }
        });
    });

    describe('compareVersions', function () {
        it('orders by major, then minor, then patch', function () {
            assert.strictEqual(checkVersion.compareVersions('1.1.23', '1.1.22'), 1);
            assert.strictEqual(checkVersion.compareVersions('1.1.22', '1.1.23'), -1);
            assert.strictEqual(checkVersion.compareVersions('1.1.22', '1.1.22'), 0);
            assert.strictEqual(checkVersion.compareVersions('1.2.0', '1.1.99'), 1);
            assert.strictEqual(checkVersion.compareVersions('2.0.0', '1.99.99'), 1);
        });
    });

    describe('evaluate', function () {
        // The repository the script reads is the one it runs in, so these drive it through a
        // throwaway clone rather than stubbing git.
        let dir: string;
        let cwd: string;

        function git(...args: string[]): string {
            return require('child_process').execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
        }

        function write(version: string, changelog: string): void {
            fs.writeFileSync(path.join(dir, 'package.json'), `{\n\t"version": "${version}"\n}\n`);
            fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelog);
        }

        beforeEach(function () {
            dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'check-')));
            git('init', '-q', '-b', 'main');
            git('config', 'user.email', 'a@b.c');
            git('config', 'user.name', 'Tester');
            // Keeps the line-ending warnings out of the test output on Windows.
            git('config', 'core.autocrlf', 'false');
            write('1.1.22', 'v1.1.22\n\n  Bugfixes:\n\n- Shipped.\n');
            fs.writeFileSync(path.join(dir, 'extension.ts'), 'source\n');
            git('add', '-A');
            git('commit', '-qm', 'Initial');
            git('tag', 'v1.1.22');
            git('checkout', '-qb', 'feature');
            cwd = process.cwd();
            process.chdir(dir);
        });

        afterEach(function () {
            process.chdir(cwd);
            fs.rmSync(dir, { recursive: true, force: true });
        });

        it('passes a branch that leaves the version alone', function () {
            fs.writeFileSync(path.join(dir, 'extension.ts'), 'source\nmore\n');
            git('commit', '-qam', 'Change the extension');

            const result = checkVersion.evaluate({ baseRef: 'main' });

            assert.strictEqual(result.ok, true);
            assert.match(result.notice, /normal way to work/);
        });

        it('passes a branch that carries a correct bump', function () {
            write('1.1.23', 'v1.1.23\n\n  Functionality:\n\n- New.\n\nv1.1.22\n\n  Bugfixes:\n\n- Shipped.\n');
            git('commit', '-qam', 'Bump by hand');

            assert.strictEqual(checkVersion.evaluate({ baseRef: 'main' }).ok, true);
        });

        it('notes a version that already shipped', function () {
            fs.writeFileSync(path.join(dir, 'extension.ts'), 'source\nmore\n');
            git('commit', '-qam', 'Change the extension');
            git('tag', 'v1.1.23');
            write('1.1.23', 'v1.1.23\n\n  Functionality:\n\n- New.\n');
            git('commit', '-qam', 'Reuse a released version');

            const result = checkVersion.evaluate({ baseRef: 'main' });

            assert.strictEqual(result.ok, false);
            assert.match(result.title, /already released/);
        });

        it('notes a version that goes backwards', function () {
            write('1.1.21', 'v1.1.22\n\n  Bugfixes:\n\n- Shipped.\n');
            git('commit', '-qam', 'Lower the version');

            const result = checkVersion.evaluate({ baseRef: 'main' });

            assert.strictEqual(result.ok, false);
            assert.match(result.title, /lowers the version/);
        });

        it('notes a changelog heading that disagrees with package.json', function () {
            write('1.1.23', 'v1.1.22\n\n  Bugfixes:\n\n- Shipped.\n');
            git('commit', '-qam', 'Forget the changelog');

            const result = checkVersion.evaluate({ baseRef: 'main' });

            assert.strictEqual(result.ok, false);
            assert.match(result.title, /does not match/);
        });

        it('says nothing about documentation-only branches', function () {
            fs.writeFileSync(path.join(dir, 'README.md'), 'docs\n');
            git('add', '-A');
            git('commit', '-qm', 'Document');

            assert.strictEqual(checkVersion.evaluate({ baseRef: 'main' }).ok, true);
        });
    });

    describe('firstHeading', function () {
        it('takes the first line that has content', function () {
            assert.strictEqual(checkVersion.firstHeading('\n\nv1.1.22\n\n  Bugfixes:\n'), 'v1.1.22');
        });

        it('returns an empty string for an empty changelog', function () {
            assert.strictEqual(checkVersion.firstHeading('   \n\n'), '');
            assert.strictEqual(checkVersion.firstHeading(undefined), '');
        });
    });

    describe('parseArgs', function () {
        it('defaults to origin/main', function () {
            assert.strictEqual(checkVersion.parseArgs([]).baseRef, 'origin/main');
        });

        it('reads the base ref', function () {
            assert.strictEqual(checkVersion.parseArgs(['--base-ref', 'origin/dev']).baseRef, 'origin/dev');
        });
    });
});

describe('scripts/release-check', function () {
    describe('decide', function () {
        it('publishes when the tag is still free and the release pull request was merged', function () {
            const result = releaseCheck.decide({
                tag: 'v1.1.24',
                tagExists: false,
                fromReleaseBranch: true,
                changedFiles: [],
            });
            assert.strictEqual(result.release, true);
            assert.strictEqual(result.bump, false);
            assert.strictEqual(result.adopt, false);
            assert.strictEqual(result.version, '1.1.24');
        });

        it('adopts a bump that came from any other branch instead of publishing it', function () {
            const result = releaseCheck.decide({
                tag: 'v1.1.24',
                tagExists: false,
                fromReleaseBranch: false,
                changedFiles: [],
            });
            assert.strictEqual(result.release, false);
            assert.strictEqual(result.bump, true);
            assert.strictEqual(result.adopt, true);
        });

        it('publishes an untagged version anyway when a run is asked for by hand', function () {
            const result = releaseCheck.decide({
                tag: 'v1.1.24',
                tagExists: false,
                fromReleaseBranch: false,
                manual: true,
                changedFiles: [],
            });
            assert.strictEqual(result.release, true);
            assert.strictEqual(result.adopt, false);
        });

        it('asks for a release pull request when the tag is taken and the extension changed', function () {
            const result = releaseCheck.decide({
                tag: 'v1.1.23',
                tagExists: true,
                changedFiles: ['README.md', 'src/extension.ts'],
            });
            assert.strictEqual(result.release, false);
            assert.strictEqual(result.bump, true);
        });

        it('does nothing when only documentation and CI changed', function () {
            const result = releaseCheck.decide({
                tag: 'v1.1.23',
                tagExists: true,
                changedFiles: ['README.md', '.github/workflows/test.yml'],
            });
            assert.strictEqual(result.release, false);
            assert.strictEqual(result.bump, false);
        });

        it('does nothing when nothing changed at all', function () {
            const result = releaseCheck.decide({ tag: 'v1.1.23', tagExists: true, changedFiles: [] });
            assert.strictEqual(result.bump, false);
        });

        it('ignores the documentation exemption for a manual run', function () {
            const result = releaseCheck.decide({
                tag: 'v1.1.23',
                tagExists: true,
                manual: true,
                changedFiles: ['README.md'],
            });
            assert.strictEqual(result.bump, true);
        });
    });

    describe('parseArgs', function () {
        it('is automatic unless told otherwise', function () {
            assert.strictEqual(releaseCheck.parseArgs([]).manual, false);
            assert.strictEqual(releaseCheck.parseArgs(['--manual']).manual, true);
        });

        it('reads the commit to look at', function () {
            const options = releaseCheck.parseArgs(['--repo', 'a/b', '--sha', 'abc123']);
            assert.strictEqual(options.repo, 'a/b');
            assert.strictEqual(options.sha, 'abc123');
        });
    });
});

describe('scripts/pr-bullets', function () {
    describe('bulletsFromPullRequests', function () {
        it('makes one bullet per pull request, in order', function () {
            const result = prBullets.bulletsFromPullRequests([
                { number: 97, title: 'Stop the stale comments', body: 'Closes #86' },
                { number: 108, title: 'Render the event preview as a workflow', body: 'no reference' },
            ]);

            assert.deepStrictEqual(result.pullRequests, [97, 108]);
            assert.deepStrictEqual(result.bullets, [
                '- Stop the stale comments. Issue #86.',
                '- Render the event preview as a workflow.',
            ]);
        });

        it('counts a pull request once when several commits point at it', function () {
            const result = prBullets.bulletsFromPullRequests([
                { number: 5, title: 'One', body: '' },
                { number: 5, title: 'One', body: '' },
            ]);

            assert.deepStrictEqual(result.pullRequests, [5]);
            assert.strictEqual(result.bullets.length, 1);
        });

        it('skips an entry without a number', function () {
            const result = prBullets.bulletsFromPullRequests([{ title: 'No number', body: '' }, undefined]);
            assert.deepStrictEqual(result, { bullets: [], pullRequests: [], entries: [] });
        });

        it('handles no pull requests at all', function () {
            assert.deepStrictEqual(prBullets.bulletsFromPullRequests(undefined),
                { bullets: [], pullRequests: [], entries: [] });
        });

        it('prefixes the bullet with the component its files earned', function () {
            const result = prBullets.bulletsFromPullRequests([{
                number: 62,
                title: 'Draw the exclusive link with the game textures',
                body: 'Closes #62',
                files: ['src/previewdef/focustree/contentbuilder.ts', 'src/previewdef/focustree/schema.ts'],
            }]);

            assert.deepStrictEqual(result.bullets,
                ['- [ Focus Tree ] Draw the exclusive link with the game textures. Issue #62.']);
            assert.strictEqual(result.entries[0].component, 'Focus Tree');
        });

        it('leaves the bullet unprefixed when the files name no single component', function () {
            const result = prBullets.bulletsFromPullRequests([{
                number: 7,
                title: 'Shared helper',
                body: '',
                files: ['src/util/html.ts'],
            }]);

            assert.deepStrictEqual(result.bullets, ['- Shared helper.']);
            assert.strictEqual(result.entries[0].component, undefined);
        });

        it('files a bug-labelled pull request under Bugfixes', function () {
            const result = prBullets.bulletsFromPullRequests([
                { number: 1, title: 'A fix', body: '', labels: [{ name: 'bug' }] },
                { number: 2, title: 'A feature', body: '', labels: [{ name: 'enhancement' }] },
                { number: 3, title: 'Unlabelled', body: '' },
            ]);

            assert.deepStrictEqual(result.entries.map((entry: { section: string }) => entry.section),
                ['Bugfixes', 'Functionality', 'Functionality']);
        });

        it('carries the title and issue into the entry, for the pull request body', function () {
            const result = prBullets.bulletsFromPullRequests([
                { number: 99, title: '  Spaced   title  ', body: 'Fixes #12' },
            ]);

            assert.deepStrictEqual(result.entries, [{
                number: 99,
                title: 'Spaced   title',
                body: 'Fixes #12',
                component: undefined,
                section: 'Functionality',
                issue: 12,
            }]);
        });
    });

    describe('withComponent', function () {
        it('inserts the prefix after the bullet marker', function () {
            assert.strictEqual(prBullets.withComponent('- A change.', 'MIO'), '- [ MIO ] A change.');
        });

        it('leaves a bullet that already carries one', function () {
            assert.strictEqual(prBullets.withComponent('- [ CI ] A change.', 'MIO'), '- [ CI ] A change.');
        });

        it('leaves the bullet alone when there is no component', function () {
            assert.strictEqual(prBullets.withComponent('- A change.', undefined), '- A change.');
        });
    });

    describe('parseArgs', function () {
        it('reads the flags the workflow passes', function () {
            const options = prBullets.parseArgs(['--tag', 'v1.1.23', '--repo', 'a/b', '--output', 'bullets.json']);
            assert.strictEqual(options.tag, 'v1.1.23');
            assert.strictEqual(options.repo, 'a/b');
            assert.strictEqual(options.output, 'bullets.json');
        });
    });
});

describe('scripts/changelog-bullets', function () {
    describe('componentForFiles', function () {
        it('names the component that owns most of the files', function () {
            assert.strictEqual(changelogBullets.componentForFiles([
                'src/previewdef/focustree/contentbuilder.ts',
                'src/previewdef/focustree/schema.ts',
                'src/util/html.ts',
            ]), 'Focus Tree');
        });

        it('reads a workflow change as CI', function () {
            assert.strictEqual(
                changelogBullets.componentForFiles(['.github/workflows/version-bump.yml']), 'CI');
        });

        it('counts the release scripts as CI but not the extension tooling', function () {
            assert.strictEqual(changelogBullets.componentForFiles(['scripts/bump-version.js']), 'CI');
            assert.strictEqual(changelogBullets.componentForFiles(['scripts/genzhi18n.js']), 'Localisation');
        });

        it('gives no prefix when nothing owns a majority', function () {
            assert.strictEqual(changelogBullets.componentForFiles([
                'src/previewdef/focustree/a.ts',
                'src/previewdef/mio/b.ts',
                'src/previewdef/event/c.ts',
                'src/previewdef/technology/d.ts',
            ]), undefined);
        });

        it('gives no prefix for files that map to nothing', function () {
            assert.strictEqual(changelogBullets.componentForFiles(['src/util/cache.ts']), undefined);
            assert.strictEqual(changelogBullets.componentForFiles([]), undefined);
            assert.strictEqual(changelogBullets.componentForFiles(undefined), undefined);
        });

        it('falls back to Previewer for a preview that has no rule of its own', function () {
            assert.strictEqual(
                changelogBullets.componentForFiles(['src/previewdef/previewmanager.ts']), 'Previewer');
        });

        it('claims the webview and stylesheet halves of a preview too', function () {
            assert.strictEqual(changelogBullets.labelFor('webviewsrc/eventtree.ts'), 'Event Tree');
            assert.strictEqual(changelogBullets.labelFor('resource/eventtree.css'), 'Event Tree');
            assert.strictEqual(changelogBullets.labelFor('webviewsrc/worldmap/renderer.ts'), 'World Map');
        });

        it('reads a test file by its own path, not by the name of what it tests', function () {
            assert.strictEqual(changelogBullets.labelFor('src/test/eventcontentbuilder.test.ts'), 'Testing');
        });

        it('sets the tests aside when the pull request also changed something else', function () {
            assert.strictEqual(changelogBullets.componentForFiles([
                'src/previewdef/mio/loader.ts',
                'src/test/a.test.ts',
                'src/test/b.test.ts',
                'src/test/c.test.ts',
            ]), 'MIO');
        });

        it('still says Testing when tests are all there is', function () {
            assert.strictEqual(
                changelogBullets.componentForFiles(['src/test/a.test.ts', 'src/test/b.test.ts']), 'Testing');
        });

        it('ignores the files that say nothing about what moved', function () {
            assert.ok(changelogBullets.ignored('CHANGELOG.md'));
            assert.ok(changelogBullets.ignored('README.md'));
            assert.ok(changelogBullets.ignored('package-lock.json'));
            assert.ok(!changelogBullets.ignored('.claude/skills/fix-issue/SKILL.md'));

            assert.strictEqual(changelogBullets.componentForFiles([
                'CHANGELOG.md',
                'README.md',
                'src/previewdef/mio/loader.ts',
            ]), 'MIO');
        });

        it('reads repository tooling as CI', function () {
            assert.strictEqual(changelogBullets.labelFor('.claude/hooks/changelog-guard.js'), 'CI');
        });
    });

    describe('sectionForPullRequest', function () {
        it('reads the pull request labels first', function () {
            assert.strictEqual(
                changelogBullets.sectionForPullRequest({ labels: [{ name: 'bug' }] }), 'Bugfixes');
            assert.strictEqual(
                changelogBullets.sectionForPullRequest({ labels: [{ name: 'enhancement' }], issueLabels: [{ name: 'bug' }] }),
                'Functionality');
        });

        it('falls back to the labels on the issue it closes', function () {
            assert.strictEqual(
                changelogBullets.sectionForPullRequest({ issueLabels: [{ name: 'bug' }] }), 'Bugfixes');
        });

        it('defaults to Functionality', function () {
            assert.strictEqual(changelogBullets.sectionForPullRequest({}), 'Functionality');
            assert.strictEqual(changelogBullets.sectionForPullRequest(undefined), 'Functionality');
        });
    });

    describe('newBullets', function () {
        it('keeps only what the other side does not already say', function () {
            assert.deepStrictEqual(
                changelogBullets.newBullets(['- One.'], ['- One.', '- Two.']),
                ['- Two.']);
        });

        it('sees through a component prefix and an issue trailer', function () {
            assert.deepStrictEqual(
                changelogBullets.newBullets(
                    ['- [ Focus Tree ] Stop drawing the red line. Issue #62.'],
                    ['- Stop drawing the red line.']),
                []);
        });

        it('treats the same issue number as the same change', function () {
            assert.deepStrictEqual(
                changelogBullets.newBullets(
                    ['- [ MIO ] A careful rewording of what happened. Issue #99.'],
                    ['- Always log focus parse failures. Issue #99.']),
                []);
        });

        it('does not add the same bullet twice from one side', function () {
            assert.deepStrictEqual(changelogBullets.newBullets([], ['- One.', '- One.']), ['- One.']);
        });

        it('handles empty input', function () {
            assert.deepStrictEqual(changelogBullets.newBullets(undefined, undefined), []);
        });
    });
});

describe('scripts/select-bullets', function () {
    const found = {
        bullets: ['- One.', '- Two.', '- Three.', '- From a bare commit.'],
        pullRequests: [11, 12, 13],
        entries: [
            { number: 11, title: 'One' },
            { number: 12, title: 'Two' },
            { number: 13, title: 'Three' },
        ],
    };

    it('drops the pull request that already wrote its own section', function () {
        const result = selectBullets.select(found, { skip: '12' });
        assert.deepStrictEqual(result.pullRequests, [11, 13]);
        assert.deepStrictEqual(result.bullets, ['- One.', '- Three.', '- From a bare commit.']);
        assert.deepStrictEqual(result.entries.map((entry: { number: number }) => entry.number), [11, 13]);
    });

    it('drops everything the release pull request already covers', function () {
        const result = selectBullets.select(found, { covered: '11, 13' });
        assert.deepStrictEqual(result.pullRequests, [12]);
        assert.deepStrictEqual(result.bullets, ['- Two.', '- From a bare commit.']);
    });

    it('keeps the bullets that belong to no pull request', function () {
        const result = selectBullets.select(found, { covered: '11,12,13' });
        assert.deepStrictEqual(result.pullRequests, []);
        assert.deepStrictEqual(result.bullets, ['- From a bare commit.']);
    });

    it('keeps everything when nothing is skipped or covered', function () {
        assert.deepStrictEqual(selectBullets.select(found, {}), found);
    });

    it('survives a missing or malformed input', function () {
        assert.deepStrictEqual(selectBullets.select({}, { covered: '1' }),
            { bullets: [], pullRequests: [], entries: [] });
    });

    describe('parseArgs', function () {
        it('reads the flags the workflow passes', function () {
            const options = selectBullets.parseArgs(
                ['--bullets-file', 'a.json', '--output', 'b.json', '--skip', '9', '--covered', '1,2']);
            assert.strictEqual(options.file, 'a.json');
            assert.strictEqual(options.output, 'b.json');
            assert.strictEqual(options.skip, '9');
            assert.strictEqual(options.covered, '1,2');
        });
    });
});

describe('scripts/release-pr-body', function () {
    const entries = [
        { number: 109, title: 'Always log focus parse failures' },
        { number: 110, title: 'Open the release pull request automatically' },
    ];

    describe('pullRequestList', function () {
        it('lists each pull request as a link GitHub resolves', function () {
            assert.strictEqual(releasePrBody.pullRequestList(entries),
                '<!-- release-pr:prs -->\n'
                + '- #109 Always log focus parse failures\n'
                + '- #110 Open the release pull request automatically\n'
                + '<!-- /release-pr:prs -->');
        });

        it('says so when there is nothing yet', function () {
            assert.ok(releasePrBody.pullRequestList([]).includes('- None yet.'));
        });
    });

    describe('render', function () {
        it('writes a body a human and the refresh step can both read', function () {
            const body = releasePrBody.render({ version: '1.1.24', entries, hasBumpToken: true });
            assert.ok(body.includes('Merging it publishes `v1.1.24`.'));
            assert.ok(body.includes('### Pull requests in this release'));
            assert.ok(body.includes('- #109 Always log focus parse failures'));
            assert.ok(body.includes('Included pull requests: 109,110'));
            assert.ok(!body.includes('BUMP_TOKEN'));
        });

        it('warns about the missing token only when there is none', function () {
            const body = releasePrBody.render({ version: '1.1.24', entries, hasBumpToken: false });
            assert.ok(body.includes('No `BUMP_TOKEN` secret is set'));
        });

        it('leaves a blank line before the heading, with the warning and without', function () {
            for (const hasBumpToken of [true, false]) {
                const body = releasePrBody.render({ version: '1.1.24', entries, hasBumpToken });
                assert.ok(body.includes('\n\n### Pull requests in this release\n\n'),
                    `run the two together without a token: ${hasBumpToken}`);
            }
        });

        it('replaces only the list when refreshing, keeping hand-written prose', function () {
            const existing = releasePrBody.render({ version: '1.1.24', entries, hasBumpToken: true })
                + '\nA note someone typed here.\n';
            const refreshed = releasePrBody.render({
                version: '1.1.25',
                entries: [...entries, { number: 114, title: 'Stop drawing the red line' }],
                existing,
            });

            assert.ok(refreshed.includes('A note someone typed here.'));
            assert.ok(refreshed.includes('- #114 Stop drawing the red line'));
            assert.ok(refreshed.includes('Included pull requests: 109,110,114'));
            assert.ok(!refreshed.includes('Included pull requests: 109,110\n'));
        });

        it('moves the version the body promises, so it agrees with the title', function () {
            const existing = releasePrBody.render({ version: '1.1.24', entries, hasBumpToken: true });
            const refreshed = releasePrBody.render({ version: '1.1.25', entries, existing });

            assert.ok(refreshed.includes('Merging it publishes `v1.1.25`.'));
            assert.ok(!refreshed.includes('v1.1.24'));
        });

        it('puts the list back when a body predates it', function () {
            const existing = 'Some intro.\n\n<!-- release-pr -->\nIncluded pull requests: 109\n';
            const refreshed = releasePrBody.render({ version: '1.1.25', entries, existing });

            assert.ok(refreshed.includes('Some intro.'));
            assert.ok(refreshed.includes('### Pull requests in this release'));
            assert.ok(refreshed.includes('- #110 Open the release pull request automatically'));
            assert.ok(refreshed.includes('Included pull requests: 109,110'));
        });

        it('puts the trailer back when it was edited away', function () {
            const refreshed = releasePrBody.render({
                version: '1.1.25',
                entries,
                existing: 'Nothing machine-readable at all.\n',
            });

            assert.ok(refreshed.includes('Included pull requests: 109,110'));
            assert.ok(refreshed.includes('### Pull requests in this release'));
        });
    });
});

describe('scripts/merge-changelog', function () {
    let dir: string;

    beforeEach(function () {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-changelog-'));
        fs.writeFileSync(path.join(dir, 'package.json'), '{\n\t"version": "1.1.24"\n}\n');
    });

    afterEach(function () {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('keeps our reworded bullet and carries over what only main has', function () {
        fs.writeFileSync(path.join(dir, 'CHANGELOG.md'),
            'v1.1.24\n\n  Functionality:\n\n- [ Focus Tree ] The red line is gone. Issue #62.\n');
        const theirs = path.join(dir, 'main-changelog.md');
        fs.writeFileSync(theirs,
            'v1.1.25\n\n  Functionality:\n\n- Stop drawing the red line. Issue #62.\n'
            + '\n  Bugfixes:\n\n- A fix only main knows about.\n');

        const result = mergeChangelog.run({ cwd: dir, theirs, version: '1.1.25' });

        assert.strictEqual(result.version, '1.1.25');
        assert.strictEqual(result.changed, true);
        assert.strictEqual(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'),
            'v1.1.25\n\n  Functionality:\n\n- [ Focus Tree ] The red line is gone. Issue #62.\n'
            + '\n  Bugfixes:\n\n- A fix only main knows about.\n');
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, '1.1.25');
    });

    it('changes nothing when main says nothing new', function () {
        const ours = 'v1.1.24\n\n  Functionality:\n\n- Already said. Issue #7.\n';
        fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), ours);
        const theirs = path.join(dir, 'main-changelog.md');
        fs.writeFileSync(theirs, 'v1.1.24\n\n  Functionality:\n\n- Worded differently. Issue #7.\n');

        const result = mergeChangelog.run({ cwd: dir, theirs, version: '1.1.24' });

        assert.strictEqual(result.changed, false);
        assert.strictEqual(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'), ours);
    });

    it('takes the version from package.json when none is passed', function () {
        fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), 'v1.1.24\n\n  Functionality:\n\n- Ours.\n');
        assert.strictEqual(mergeChangelog.run({ cwd: dir, theirs: '' }).version, '1.1.24');
    });

    describe('parseArgs', function () {
        it('reads the flags the workflow passes', function () {
            const options = mergeChangelog.parseArgs(['--theirs', 'main.md', '--version', '1.1.25']);
            assert.strictEqual(options.theirs, 'main.md');
            assert.strictEqual(options.version, '1.1.25');
        });
    });
});

describe('scripts/rewrite-bullets', function () {
    // Every fallback path below announces itself as a `::warning::` or `::notice::` on stdout, which
    // is the point of it -- but a hundred lines of workflow annotations in the test output would
    // bury the results, so the block swallows them.
    let originalWrite: typeof process.stdout.write;

    beforeEach(function () {
        originalWrite = process.stdout.write;
        process.stdout.write = ((chunk: string | Uint8Array) =>
            /^::(warning|notice)::/.test(String(chunk)) ? true : originalWrite.call(process.stdout, chunk)
        ) as typeof process.stdout.write;
    });

    afterEach(function () {
        process.stdout.write = originalWrite;
    });

    describe('cleanReply', function () {
        it('takes the sentence out of a code fence', function () {
            assert.strictEqual(
                rewriteBullets.cleanReply('```\nThe preview now opens quickly.\n```'),
                'The preview now opens quickly.');
        });

        it('takes the answer rather than the reasoning that precedes it', function () {
            assert.strictEqual(
                rewriteBullets.cleanReply('Let me think about this.\n\nThe preview now opens quickly.'),
                'The preview now opens quickly.');
        });

        it('handles an empty reply', function () {
            assert.strictEqual(rewriteBullets.cleanReply(''), '');
            assert.strictEqual(rewriteBullets.cleanReply(undefined), '');
        });
    });

    describe('acceptable', function () {
        it('takes an ordinary sentence', function () {
            assert.ok(rewriteBullets.acceptable('The preview now opens quickly.'));
        });

        it('rejects a reply that writes its own marker, prefix or issue trailer', function () {
            assert.ok(!rewriteBullets.acceptable('- The preview now opens quickly.'));
            assert.ok(!rewriteBullets.acceptable('[ Focus Tree ] The preview now opens quickly.'));
            assert.ok(!rewriteBullets.acceptable('The preview now opens quickly. Issue #4.'));
        });

        it('rejects an empty, multi-line or runaway reply', function () {
            assert.ok(!rewriteBullets.acceptable('   '));
            assert.ok(!rewriteBullets.acceptable('One.\nTwo.'));
            assert.ok(!rewriteBullets.acceptable('x'.repeat(601)));
        });
    });

    describe('assemble', function () {
        it('puts the prefix, the sentence and the issue back together', function () {
            assert.strictEqual(
                rewriteBullets.assemble('The red line is gone', { component: 'Focus Tree', issue: 62 }),
                '- [ Focus Tree ] The red line is gone. Issue #62.');
        });

        it('leaves out what the entry does not have', function () {
            assert.strictEqual(rewriteBullets.assemble('A change.', {}), '- A change.');
        });
    });

    describe('describe', function () {
        it('tells the model the kind without naming the label', function () {
            const prompt = rewriteBullets.describe(
                { number: 4, title: 'A fix', section: 'Bugfixes', component: 'MIO', body: 'Closes #4' });
            assert.ok(prompt.includes('Pull request #4'));
            assert.ok(prompt.includes('Title: A fix'));
            assert.ok(prompt.includes('Area: MIO'));
            assert.ok(prompt.includes('bug fix'));
        });
    });

    describe('rewrite', function () {
        const entries = [
            { number: 1, title: 'First', section: 'Functionality' },
            { number: 2, title: 'Second', section: 'Bugfixes' },
        ];
        let calls: string[];
        let original: typeof globalThis.fetch;

        function reply(content: string): unknown {
            return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
        }

        beforeEach(function () {
            calls = [];
            original = globalThis.fetch;
        });

        afterEach(function () {
            globalThis.fetch = original;
        });

        it('takes every bullet from one structured reply', async function () {
            globalThis.fetch = (async (_url: string, init: { body: string }) => {
                calls.push(init.body);
                return reply(JSON.stringify({
                    bullets: [
                        { number: 1, text: 'The first thing works.' },
                        { number: 2, text: 'The second is fixed.' },
                    ],
                }));
            }) as unknown as typeof globalThis.fetch;

            const written = await rewriteBullets.rewrite(entries, 'key');
            assert.strictEqual(calls.length, 1);
            assert.strictEqual(written.get(1), 'The first thing works.');
            assert.strictEqual(written.get(2), 'The second is fixed.');
        });

        it('retries one at a time when the structured reply is unusable', async function () {
            let first = true;
            globalThis.fetch = (async (_url: string, init: { body: string }) => {
                calls.push(init.body);
                if (first) {
                    first = false;
                    return reply('not json at all');
                }
                return reply('A sentence for whichever bullet this is.');
            }) as unknown as typeof globalThis.fetch;

            const written = await rewriteBullets.rewrite(entries, 'key');
            assert.strictEqual(calls.length, 3);
            assert.strictEqual(written.size, 2);
        });

        it('keeps the seeded wording when the retry breaks the rules too', async function () {
            const broken = async () => reply('- [ MIO ] A reply that broke every rule. Issue #1.');
            globalThis.fetch = broken as unknown as typeof globalThis.fetch;

            assert.strictEqual((await rewriteBullets.rewrite(entries, 'key')).size, 0);
        });

        it('keeps the seeded wording when the request fails', async function () {
            globalThis.fetch = (async () => ({
                ok: false,
                status: 500,
                text: async () => 'upstream is down',
            })) as unknown as typeof globalThis.fetch;

            assert.strictEqual((await rewriteBullets.rewrite(entries, 'key')).size, 0);
        });

        it('asks for nothing when there is nothing to rewrite', async function () {
            globalThis.fetch = (async () => {
                throw new Error('should not be called');
            }) as unknown as typeof globalThis.fetch;

            assert.strictEqual((await rewriteBullets.rewrite([], 'key')).size, 0);
        });
    });

    describe('check', function () {
        let original: typeof globalThis.fetch;

        beforeEach(function () {
            original = globalThis.fetch;
        });

        afterEach(function () {
            globalThis.fetch = original;
        });

        it('reports no key without calling anything', async function () {
            globalThis.fetch = (async () => {
                throw new Error('should not be called');
            }) as unknown as typeof globalThis.fetch;

            assert.strictEqual(await rewriteBullets.check(''), false);
        });

        it('accepts a working key', async function () {
            globalThis.fetch = (async () => ({
                ok: true,
                status: 200,
                json: async () => ({ data: { label: 'release', limit: null, usage: 0 } }),
            })) as unknown as typeof globalThis.fetch;

            assert.strictEqual(await rewriteBullets.check('key'), true);
        });

        it('reports a rejected key', async function () {
            globalThis.fetch = (async () => ({ ok: false, status: 401 })) as unknown as typeof globalThis.fetch;
            assert.strictEqual(await rewriteBullets.check('key'), false);
        });
    });

    describe('parseArgs', function () {
        it('reads the flags the workflow passes', function () {
            assert.strictEqual(rewriteBullets.parseArgs(['--bullets-file', 'a.json']).file, 'a.json');
            assert.strictEqual(rewriteBullets.parseArgs(['--check']).check, true);
        });
    });
});
