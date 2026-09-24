import { loadEntrypoint } from './setup';
import * as assert from 'assert';

// focustree.ts reads window.focusTrees at module scope and binds its handlers to window load and
// message. Only the exported helpers are under test, so it is loaded with those listeners held back.
(global as any).window.focusTrees = [];

const focustree = loadEntrypoint(
    () => require('../../../webviewsrc/focustree') as typeof import('../../../webviewsrc/focustree'),
).module;

const { search } = focustree;

function buildTree(ids: string[]): HTMLDivElement[] {
    document.body.innerHTML = '';
    return ids.map(id => {
        const div = document.createElement('div');
        div.className = 'focus';
        div.id = 'focus_' + id;
        div.scrollIntoView = () => undefined;
        document.body.appendChild(div);
        return div;
    });
}

const hits = (elements: HTMLDivElement[]) =>
    elements.filter(e => e.classList.contains('focus-search-hit')).map(e => e.id);

describe('webview/focustree search', () => {
    it('marks the matching focuses and nothing else', () => {
        const elements = buildTree(['ENG_navy', 'ENG_army', 'FRA_navy']);

        const found = search('navy', false);

        assert.deepStrictEqual(found.map(e => e.id), ['focus_ENG_navy', 'focus_FRA_navy']);
        assert.deepStrictEqual(hits(elements), ['focus_ENG_navy', 'focus_FRA_navy']);
    });

    it('clears the highlight off a focus the narrowed query no longer matches', () => {
        // The highlight is a class kept on only the nodes that carry it, so a narrowing keystroke
        // has to take it back off the ones that dropped out rather than leaving them lit.
        const elements = buildTree(['ENG_navy', 'ENG_army']);

        search('eng', false);
        assert.deepStrictEqual(hits(elements), ['focus_ENG_navy', 'focus_ENG_army']);

        search('eng_na', false);
        assert.deepStrictEqual(hits(elements), ['focus_ENG_navy']);

        search('', false);
        assert.deepStrictEqual(hits(elements), []);
    });

    it('leaves a focus alone when its highlight did not change', () => {
        // Nothing should be written to a node that was a hit and still is: on a big tree that is
        // the difference between touching every node per keystroke and touching a handful.
        const [element] = buildTree(['ENG_navy']);
        search('nav', false);

        let writes = 0;
        const realAdd = element!.classList.add.bind(element!.classList);
        const realRemove = element!.classList.remove.bind(element!.classList);
        element!.classList.add = ((...args: string[]) => { writes++; realAdd(...args); }) as any;
        element!.classList.remove = ((...args: string[]) => { writes++; realRemove(...args); }) as any;

        search('navy', false);

        assert.strictEqual(writes, 0);
        assert.deepStrictEqual(hits([element!]), ['focus_ENG_navy']);
    });
});
