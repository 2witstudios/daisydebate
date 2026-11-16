import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Glob } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();
const source = resolve(import.meta.dir, '../..');
const app = join(source, 'app');
const productionPages = [...new Glob('**/page.tsx').scanSync(app)].filter(
  (file) =>
    /^(\(host\)|\(tab\)|\(tab-live\))\//.test(file) &&
    !file.includes('/walk/') &&
    !file.includes('/leagues/'),
);
const read = (file: string) => readFileSync(file, 'utf8');

/** Follow local value imports, since a clean page can still import a sample-backed projector. */
const sampleDependencies = (entry: string): readonly string[] => {
  const seen = new Set<string>();
  const samples = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (file.includes('/features/tab/sample/')) {
      samples.add(file.slice(source.length + 1));
      return;
    }
    const text = read(file).replace(
      /import\s+type\s+[\s\S]*?from\s*['"][^'"]+['"];?/g,
      '',
    );
    for (const match of text.matchAll(
      /(?:import|export)\s+[\s\S]*?from\s*['"](\.[^'"]+)['"]/g,
    )) {
      const address = resolve(dirname(file), match[1]!);
      const target = [
        address,
        `${address}.ts`,
        `${address}.tsx`,
        join(address, 'index.ts'),
      ].find((candidate) => existsSync(candidate) && /\.tsx?$/.test(candidate));
      if (target) visit(target);
    }
  };
  visit(entry);
  return [...samples].sort();
};

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
  test('sample facts stay in the walk', () => {
    assert({
      given:
        'the complete value import graph of every non-league production Tab page',
      should: 'never load sample facts, even through a presentation projector',
      actual: productionPages.flatMap((file) =>
        sampleDependencies(join(app, file)).map((dependency) => [
          file,
          dependency,
        ]),
      ),
      expected: [],
    });
  });
});
