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
        it('publishes when the tag is still free', function () {
            const result = releaseCheck.decide({ tag: 'v1.1.24', tagExists: false, changedFiles: [] });
            assert.strictEqual(result.release, true);
            assert.strictEqual(result.bump, false);
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
            assert.deepStrictEqual(result, { bullets: [], pullRequests: [] });
        });

        it('handles no pull requests at all', function () {
            assert.deepStrictEqual(prBullets.bulletsFromPullRequests(undefined),
                { bullets: [], pullRequests: [] });
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
