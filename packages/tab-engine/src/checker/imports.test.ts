import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

const here = import.meta.dir;
const shapes = resolve(here, '../shapes');

/** Every non-test source file under src/checker, at any depth. */
const sourcesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourcesUnder(path);
    return name.endsWith('.ts') &&
      !name.endsWith('.test.ts') &&
      !name.endsWith('.test-support.ts')
      ? [path]
      : [];
  });

const within = (path: string, dir: string) =>
  path === dir || path.startsWith(dir + sep);

/** A relative specifier must resolve under src/shapes or src/checker; a bare one may only be seeded randomness. */
const allowed = (file: string, specifier: string) => {
  if (!specifier.startsWith('.')) return specifier === '@daisy/seeded-random';
  const target = resolve(dirname(file), specifier);
  return within(target, shapes) || within(target, here);
};

/** Ways to load code that a static scan of `from '…'` would miss. */
const dynamicLoads =
  /\brequire\s*\(|\bimport\s*\(|\bimport\s+\w+\s*=\s*require\b/;

const specifiersOf = (text: string) =>
  [
    ...text.matchAll(
      /\b(?:from|import)\s*['"]([^'"]+)['"]|\bexport\s+(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g,
    ),
  ].map((m) => (m[1] ?? m[2])!);

describe('the checker stays independent', () => {
  test('checker source imports only the shapes, itself and seeded randomness', () => {
    const sources = sourcesUnder(here);
    const strays = sources.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      const name = relative(here, file);
      return [
        ...specifiersOf(text)
          .filter((s) => !allowed(file, s))
          .map((s) => `${name}: ${s}`),
        ...(dynamicLoads.test(text) ? [`${name}: a dynamic load`] : []),
      ];
    });
    assert({
      given: `the ${sources.length} non-test source files under src/checker`,
      should:
        'import nothing from the solver, the draw, the assessment or the settings registry',
      actual: { strays, checked: sources.length > 5 },
      expected: { strays: [], checked: true },
    });
  });

  test('the scan catches what it is for', () => {
    const file = join(here, 'x.ts');
    assert({
      given: 'specifiers escaping to the draw, a package, and the shapes',
      should: 'refuse the first two and allow the shapes and the checker',
      actual: [
        allowed(file, '../draw'),
        allowed(file, './../solve/index'),
        allowed(file, '@daisy/protocol'),
        allowed(file, '../shapes/draw'),
        allowed(file, './past'),
        dynamicLoads.test("const m = require('x')"),
        dynamicLoads.test("await import('../draw')"),
        dynamicLoads.test("import x = require('y')"),
      ],
      expected: [false, false, false, true, true, true, true, true],
    });
  });
});
