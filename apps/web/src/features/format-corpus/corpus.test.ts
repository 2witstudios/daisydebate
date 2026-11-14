import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { corpusCases, corpusText } from './corpus';

setupRitewayBun();

const root = join(import.meta.dir, 'corpus');
const updating = process.env['GOLDEN_UPDATE'] === '1';
const cases = corpusCases();

const filesUnder = (folder: string): readonly string[] =>
  readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(folder, entry.name))
      : [relative(root, join(folder, entry.name))],
  );

const readCase = (path: string): string | null => {
  try {
    return readFileSync(join(root, path), 'utf8');
  } catch {
    return null;
  }
};

if (updating) {
  rmSync(root, { recursive: true, force: true });
  for (const { path, value } of cases) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), corpusText(value));
  }
}

describe('the two-sided golden corpus (TAB-6.1)', () => {
  test('holds exactly the generated cases', () => {
    assert({
      given: 'the corpus folder',
      should: 'hold one file per generated case and nothing else',
      actual: [...filesUnder(root)].sort(),
      expected: cases.map(({ path }) => path).sort(),
    });
  });

  for (const { path, value } of cases)
    test(path, () => {
      assert({
        given: `the regenerated ${path}`,
        should: 'match the committed file byte for byte',
        actual: corpusText(value) === readCase(path),
        expected: true,
      });
    });
});
