import * as assert from 'assert';
import { YamlLoader } from '../util/loader/yaml';
import { LoaderSession } from '../util/loader/loader';

describe('util/loader/yaml', () => {
    describe('YamlLoader', () => {
        it('parses YAML from the content provider and reports the file as its dependency', async () => {
            const loader = new YamlLoader('a.yml', async () => 'a: 1\nb: hello');
            const result = await loader.load(new LoaderSession(false));

            assert.deepStrictEqual(result.result, { a: 1, b: 'hello' });
            assert.deepStrictEqual(result.dependencies, ['a.yml']);
        });

        it('rethrows when the content provider fails', async () => {
            const originalError = console.error;
            console.error = () => undefined; // ContentLoader logs the read error; swallow it
            try {
                const loader = new YamlLoader('a.yml', async () => { throw new Error('read fail'); });
                await assert.rejects(loader.load(new LoaderSession(false)), /read fail/);
            } finally {
                console.error = originalError;
            }
        });
    });
});
