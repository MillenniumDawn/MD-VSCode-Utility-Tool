import * as assert from 'assert';
import { parseHoi4File } from '../hoiformat/hoiparser';
import { getMiosFromFile } from '../previewdef/mio/schema';

describe('previewdef/mio/schema tree_header_text', () => {
    it('parses multiple tree_header_text blocks into textHeaders', () => {
        const input = `
            test_org = {
                name = test_org
                tree_header_text = {
                    text = test_org_first_header
                    x = 2
                }
                tree_header_text = {
                    text = test_org_second_header
                    x = 6
                }
                trait = {
                    token = test_org_trait
                    position = { x = 2 y = 0 }
                }
            }
        `;
        const mios = getMiosFromFile(parseHoi4File(input), [], 'test.txt');
        assert.strictEqual(mios.length, 1);
        assert.deepStrictEqual(mios[0].textHeaders, [
            { text: 'test_org_first_header', x: 2 },
            { text: 'test_org_second_header', x: 6 },
        ]);
    });

    it('yields an empty textHeaders array when the field is absent', () => {
        const input = `
            test_org = {
                name = test_org
                trait = {
                    token = test_org_trait
                    position = { x = 0 y = 0 }
                }
            }
        `;
        const mios = getMiosFromFile(parseHoi4File(input), [], 'test.txt');
        assert.strictEqual(mios.length, 1);
        assert.deepStrictEqual(mios[0].textHeaders, []);
    });

    it('defaults a missing x to 0 and skips a header with no text', () => {
        const input = `
            test_org = {
                name = test_org
                tree_header_text = {
                    text = test_org_header_no_x
                }
                tree_header_text = {
                    x = 4
                }
            }
        `;
        const mios = getMiosFromFile(parseHoi4File(input), [], 'test.txt');
        assert.deepStrictEqual(mios[0].textHeaders, [
            { text: 'test_org_header_no_x', x: 0 },
        ]);
    });
});
