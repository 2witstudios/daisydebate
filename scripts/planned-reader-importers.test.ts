import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { collectImporters, moduleLinks } from './planned-reader-importers';

setupRitewayBun();

const root = resolve(import.meta.dir, '..');

describe('moduleLinks', () => {
  test('reads imports, re-exports and dynamic imports from the AST', () => {
    const links = moduleLinks(
      'apps/web/src/a.ts',
      [
        "import one, { a, b as c } from './one';",
        "import type { T } from './two';",
        "import * as all from './three';",
        "export { d as e } from './four';",
        "export * from './five';",
        "const lazy = () => import('./six');",
        "type R = import('./seven').Outer.Inner;",
        "export * as contents from './eight';",
      ].join('\n'),
    );
    assert({
      given: 'every way a module names another',
      should: 'record each imported name by the name its source exports',
      actual: {
        imports: links.imports,
        reexports: [...links.reexports],
        stars: links.stars,
      },
      expected: {
        imports: [
          ['./one', ['default', 'a', 'b']],
          ['./two', ['T']],
          ['./three', ['*']],
          ['./six', ['*']],
          ['./seven', ['Outer']],
        ],
        reexports: [
          ['e', ['./four', 'd']],
          ['contents', ['./eight', '*']],
        ],
        stars: ['./five'],
      },
    });
  });
});

describe('collectImporters', () => {
  test('follows a barrel and a workspace subpath to the declaring file', () => {
    // Real files inside the repository, so specifiers resolve as the gate's do.
    const scratch = mkdtempSync(join(root, 'scripts/.planned-reader-'));
    const base = scratch.slice(root.length + 1);
    mkdirSync(join(scratch, 'lib'));
    const file = (path: string, text: string) => {
      writeFileSync(join(scratch, path), text);
      return join(scratch, path);
    };
    const files = [
      file('lib/leaf.ts', 'export const leaf = 1;'),
      file('lib/index.ts', "export * from './leaf';"),
      file('reader.ts', "import { leaf } from './lib';"),
      file('lib/named.ts', "export { leaf as renamed } from './leaf';"),
      file('namespace.ts', "import * as all from './lib/named';"),
      file('dynamic.ts', "const lazy = () => import('./lib/named');"),
      file(
        'protocol-reader.ts',
        "import { lobbyLadderSchema } from '@daisy/protocol/lobby/lobby-read';",
      ),
    ];
    const importers = collectImporters(files);
    rmSync(scratch, { recursive: true });
    assert({
      given:
        'named, namespace and dynamic imports through re-exporting modules',
      should: 'count each importer against the file that declares the name',
      actual: importers.get(`${base}/lib/leaf.ts|leaf`),
      expected: [
        `${base}/reader.ts`,
        `${base}/namespace.ts`,
        `${base}/dynamic.ts`,
      ],
    });
    assert({
      given: 'an import of a workspace export-map subpath',
      should: 'resolve it to the file the package exports there',
      actual: importers.get(
        'packages/protocol/src/lobby/lobby-read.ts|lobbyLadderSchema',
      ),
      expected: [`${base}/protocol-reader.ts`],
    });
  });
});
