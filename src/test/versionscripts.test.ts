import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Plain CommonJS helpers shared by the version-check and version-bump workflows. They deliberately
// live outside src/ so CI can run them without a build, so they are pulled in through require.
const bumpVersion = require('../../../scripts/bump-version');
const checkVersion = require('../../../scripts/check-version');

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
                '.claude/hooks/changelog-guard.js', 'LICENSE', '.gitignore', '.vscodeignore']) {
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
