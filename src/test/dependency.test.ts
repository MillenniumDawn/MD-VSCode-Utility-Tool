import * as assert from 'assert';
import {
    collectLinkedEvents,
    getDependenciesFromText,
    loadBounded,
    localisationKeysOf,
} from '../util/dependency';
import { HOIEvent, HOIEventOption } from '../previewdef/event/schema';

function option(name: string | undefined, children: string[]): HOIEventOption {
    return {
        name,
        childEvents: children.map((eventName) => ({
            scopeName: '',
            eventName,
            days: 0,
            hours: 0,
            randomDays: 0,
            randomHours: 0,
            condition: true,
        })),
        token: undefined,
        trigger: true,
        effects: [],
    };
}

function event(spec: {
    id: string;
    file: string;
    title?: string;
    immediate?: string[];
    options?: { name?: string; children?: string[] }[];
}): HOIEvent {
    return {
        type: 'country',
        id: spec.id,
        title: spec.title ?? `${spec.id}.t`,
        namespace: spec.id.split('.')[0]!,
        immediate: option(undefined, spec.immediate ?? []),
        after: option(undefined, []),
        options: (spec.options ?? []).map((o) => option(o.name, o.children ?? [])),
        token: undefined,
        major: false,
        hidden: false,
        isTriggeredOnly: true,
        meanTimeToHappenBase: 0,
        fire_only_once: false,
        file: spec.file,
        trigger: true,
    };
}

describe('util/dependency', () => {
    describe('collectLinkedEvents', () => {
        it('follows the events the main event fires, transitively, and lists each file once', () => {
            const main = event({ id: 'main.1', file: 'events/main.txt', immediate: ['a.1'] });
            const a = event({ id: 'a.1', file: 'events/a.txt', options: [{ name: 'a.1.a', children: ['b.1'] }] });
            const b = event({ id: 'b.1', file: 'events/b.txt' });
            const unrelated = event({ id: 'z.1', file: 'events/z.txt', immediate: ['z.2'] });

            const result = collectLinkedEvents([main], [b, a, unrelated]);

            assert.deepStrictEqual(result.includedEventFiles, ['events/a.txt', 'events/b.txt']);
            assert.deepStrictEqual(result.searchedEvents.map((e) => e.id), ['main.1', 'a.1', 'b.1']);
        });

        it('follows the events that fire the main event, and their own parents', () => {
            const main = event({ id: 'main.1', file: 'events/main.txt' });
            const parent = event({ id: 'p.1', file: 'events/p.txt', options: [{ children: ['main.1'] }] });
            const grandparent = event({ id: 'g.1', file: 'events/g.txt', immediate: ['p.1'] });

            const result = collectLinkedEvents([main], [grandparent, parent]);

            assert.deepStrictEqual(result.includedEventFiles, ['events/p.txt', 'events/g.txt']);
        });

        it('terminates on a cycle and does not include the main file', () => {
            const main = event({ id: 'main.1', file: 'events/main.txt', immediate: ['a.1'] });
            const a = event({ id: 'a.1', file: 'events/a.txt', immediate: ['b.1'] });
            const b = event({ id: 'b.1', file: 'events/a.txt', immediate: ['main.1', 'a.1'] });

            const result = collectLinkedEvents([main], [a, b]);

            assert.deepStrictEqual(result.includedEventFiles, ['events/a.txt']);
            assert.deepStrictEqual(result.searchedEvents.map((e) => e.id).sort(), ['a.1', 'b.1', 'main.1']);
        });

        it('includes every file that defines a reached id', () => {
            const main = event({ id: 'main.1', file: 'events/main.txt', immediate: ['dup.1'] });
            const first = event({ id: 'dup.1', file: 'events/first.txt' });
            const second = event({ id: 'dup.1', file: 'events/second.txt' });

            const result = collectLinkedEvents([main], [first, second]);

            assert.deepStrictEqual(result.includedEventFiles, ['events/first.txt', 'events/second.txt']);
        });

        it('reaches nothing when the main event is not linked to any other', () => {
            const main = event({ id: 'main.1', file: 'events/main.txt', immediate: ['missing.1'] });
            const other = event({ id: 'o.1', file: 'events/o.txt' });

            const result = collectLinkedEvents([main], [other]);

            assert.deepStrictEqual(result.includedEventFiles, []);
            assert.deepStrictEqual(result.searchedEvents, [main]);
        });
    });

    describe('localisationKeysOf', () => {
        it('collects titles and option names, skipping missing names', () => {
            const a = event({ id: 'a.1', file: 'f', title: 'a.1.t', options: [{ name: 'a.1.a' }, {}] });
            const b = event({ id: 'b.1', file: 'f', title: '', options: [{ name: 'b.1.a' }] });

            assert.deepStrictEqual([...localisationKeysOf([a, b])], ['a.1.t', 'a.1.a', 'b.1.a']);
        });
    });

    describe('loadBounded', () => {
        it('keeps the results in file order and drops the files that fail or return nothing', async () => {
            const result = await loadBounded(['a', 'b', 'c', 'd'], async (file) => {
                if (file === 'b') {
                    throw new Error('unreadable');
                }
                if (file === 'c') {
                    return undefined;
                }
                return file.toUpperCase();
            });

            assert.deepStrictEqual(result, ['A', 'D']);
        });
    });

    describe('getDependenciesFromText', () => {
        it('returns an empty list for text with no dependency markers', () => {
            assert.deepStrictEqual(getDependenciesFromText(''), []);
            assert.deepStrictEqual(getDependenciesFromText('name = 1\nother = 2\n'), []);
        });

        it('parses a single dependency marker', () => {
            const result = getDependenciesFromText('#!event:events/foo.txt\n');
            assert.deepStrictEqual(result, [{ type: 'event', path: 'events/foo.txt' }]);
        });

        it('parses txt and yml markers, and includes type===ext markers', () => {
            // The filter is `type === ext || ext === 'txt' || ext === 'yml'`.
            // For a marker like `#!sprite:gfx/sprite.gfx`, type=`sprite` and ext=`gfx`,
            // so it is filtered out. The only way a type can match its extension is
            // when the extension literally equals the type (e.g. `#!sprite:foo.sprite`).
            const text = [
                '#!event:events/foo.txt',
                '#!localisation:localisation/replace/english.yml',
                '#!sprite:data/foo.sprite',
                '#!sprite:gfx/sprite.gfx',
                '#!other:foo.bar',
            ].join('\n') + '\n';

            const result = getDependenciesFromText(text);
            assert.deepStrictEqual(result, [
                { type: 'event', path: 'events/foo.txt' },
                { type: 'localisation', path: 'localisation/replace/english.yml' },
                { type: 'sprite', path: 'data/foo.sprite' },
            ]);
        });

        it('ignores lines where the extension is unsupported', () => {
            const text = [
                '#!event:events/foo.png',
                '#!note:docs/readme.md',
                '#!event:events/bar.txt',
            ].join('\n') + '\n';

            const result = getDependenciesFromText(text);
            assert.deepStrictEqual(result, [{ type: 'event', path: 'events/bar.txt' }]);
        });

        it('accepts leading whitespace before the marker', () => {
            const result = getDependenciesFromText('   #!event:events/foo.txt\n');
            assert.deepStrictEqual(result, [{ type: 'event', path: 'events/foo.txt' }]);
        });

        it('does not match markers that are not at the start of a line', () => {
            const result = getDependenciesFromText('desc = "#!event:events/foo.txt"\n');
            assert.deepStrictEqual(result, []);
        });

        it('preserves multiple dependencies in declaration order', () => {
            const text = [
                '#!event:events/a.txt',
                '#!event:events/b.txt',
                '#!localisation:localisation/a.yml',
                '#!event:events/c.txt',
            ].join('\n') + '\n';

            const result = getDependenciesFromText(text);
            assert.deepStrictEqual(result, [
                { type: 'event', path: 'events/a.txt' },
                { type: 'event', path: 'events/b.txt' },
                { type: 'localisation', path: 'localisation/a.yml' },
                { type: 'event', path: 'events/c.txt' },
            ]);
        });

        it('normalizes multiple slashes and backslashes in the path to a single forward slash', () => {
            const result = getDependenciesFromText([
                '#!event:events\\\\sub\\\\foo.txt',
                '#!event:events//sub//bar.txt',
            ].join('\n') + '\n');

            assert.deepStrictEqual(result, [
                { type: 'event', path: 'events/sub/foo.txt' },
                { type: 'event', path: 'events/sub/bar.txt' },
            ]);
        });

        it('does not match when the path has leading whitespace after the colon', () => {
            // The path group in the regex is `.*\.ext$` and the regex is anchored to
            // end-of-line, so the entire `  events/foo.txt  ` becomes the path and the
            // extension (`txt  `) does not match the txt/yml filter. Document the
            // behaviour: dependency markers must not have leading whitespace after the colon.
            const result = getDependenciesFromText('#!event:  events/foo.txt  \n');
            assert.deepStrictEqual(result, []);
        });

        it('ignores comment-like text that is not a marker', () => {
            const result = getDependenciesFromText('# this is a regular comment\n#!event:events/foo.txt\n');
            assert.deepStrictEqual(result, [{ type: 'event', path: 'events/foo.txt' }]);
        });
    });
});
