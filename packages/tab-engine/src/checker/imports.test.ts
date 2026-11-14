import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

const here = import.meta.dir;
const allowed = (specifier: string) =>
  specifier.startsWith('../shapes/') ||
  specifier.startsWith('./') ||
  specifier === '@daisy/seeded-random';

describe('the checker stays independent', () => {
  test('checker source imports only the shapes, itself and seeded randomness', () => {
    const sources = readdirSync(here).filter(
      (name) =>
        name.endsWith('.ts') &&
        !name.endsWith('.test.ts') &&
        !name.endsWith('.test-support.ts'),
    );
    const strays = sources.flatMap((name) => {
      const text = readFileSync(join(here, name), 'utf8');
      const specifiers = [
        ...text.matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g),
      ].map((m) => m[1]!);
      return specifiers.filter((s) => !allowed(s)).map((s) => `${name}: ${s}`);
    });
    assert({
      given: `the ${sources.length} non-test source files of src/checker`,
      should:
        'import nothing from the solver, the draw, the assessment or the settings registry',
      actual: { strays, checked: sources.length > 5 },
      expected: { strays: [], checked: true },
    });
  });
});
