import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Glob } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();
const source = resolve(import.meta.dir, '../..');
const app = join(source, 'app');
const productionPages = [...new Glob('**/page.tsx').scanSync(app)].filter(
  (file) => /^(\(host\)|\(tab\)|\(tab-live\))\//.test(file),
);
const read = (file: string) => readFileSync(file, 'utf8');

describe('production Tab routes', () => {
  test('every lobby handle uses the production path', () => {
    assert({
      given: 'wired production pages, including autumn-open and winter-classic',
      should:
        'never branch on reserved sample handles or submit a simulated action',
      actual: productionPages.filter((file) =>
        /AUTUMN|WINTER|sampleSubmit|sampleAction|requestSampleScene|requireGrant\(/.test(
          read(join(app, file)),
        ),
      ),
      expected: [],
    });
  });
});
