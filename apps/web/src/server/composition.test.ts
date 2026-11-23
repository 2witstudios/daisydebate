import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { assert, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

const features = path.join(import.meta.dir, '../features');
const named = /defineComposition\(\s*'([^']+)'/g;

test('every feature composition has a name of its own', () => {
  const names = (readdirSync(features, { recursive: true }) as string[])
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .flatMap((file) => [
      ...readFileSync(path.join(features, file), 'utf8').matchAll(named),
    ])
    .map((match) => match[1]);
  const repeated = names.filter((name, index) => names.indexOf(name) !== index);
  assert({
    given: 'the compositions the features define',
    should: 'name each once, since the process caches them by name',
    actual: { repeated, some: names.length > 20 },
    expected: { repeated: [], some: true },
  });
});
