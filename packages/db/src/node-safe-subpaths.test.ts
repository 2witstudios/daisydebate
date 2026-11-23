import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import manifest from '../package.json';

setupRitewayBun();

/**
 * Subpaths a process outside Bun loads: Playwright runs the browser suites
 * under Node (apps/web/e2e), and its support code classifies a lane's
 * capacity refusal and seeds Tab and the reference formats through these. A
 * runtime import of Bun's client anywhere beneath one fails that process
 * with "Cannot find package 'bun'".
 */
const nodeSafe = [
  './capacity',
  './service-lease-lapse',
  './database-failure',
  './tab',
  './reference-formats',
] as const;

const bunRuntime = (specifier: string) =>
  specifier === 'bun' ||
  specifier.startsWith('bun:') ||
  specifier === 'drizzle-orm/bun-sql';

const asModule = (base: string) =>
  [base, `${base}.ts`, join(base, 'index.ts')].find(
    (candidate) => candidate.endsWith('.ts') && existsSync(candidate),
  );

/** The specifiers a module loads when it runs; type-only imports are erased. */
const runtimeSpecifiers = (path: string) => {
  const file = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
  );
  return file.statements.flatMap((statement) => {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      const typeOnly =
        clause?.isTypeOnly ||
        (clause &&
          !clause.name &&
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((element) => element.isTypeOnly));
      return typeOnly ? [] : [statement.moduleSpecifier.text];
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      !statement.isTypeOnly
    ) {
      const clause = statement.exportClause;
      const typeOnly =
        clause &&
        ts.isNamedExports(clause) &&
        clause.elements.length > 0 &&
        clause.elements.every((element) => element.isTypeOnly);
      return typeOnly ? [] : [statement.moduleSpecifier.text];
    }
    return [];
  });
};

/** The first chain of runtime imports from `entry` that reaches Bun, or null. */
const bunChain = (entry: string): string[] | null => {
  const root = join(import.meta.dir, '..');
  const seen = new Set<string>();
  const queue: [string, string[]][] = [[entry, [relative(root, entry)]]];
  while (queue.length > 0) {
    const [path, chain] = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    for (const specifier of runtimeSpecifiers(path)) {
      if (bunRuntime(specifier)) return [...chain, specifier];
      if (!specifier.startsWith('.')) continue;
      const next = asModule(join(dirname(path), specifier));
      if (next) queue.push([next, [...chain, relative(root, next)]]);
    }
  }
  return null;
};

test('the subpaths Node loads never reach Bun at runtime', () => {
  const exports = manifest.exports as Record<string, string>;
  assert({
    given: 'each subpath the Node-run browser suites import',
    should: 'load no runtime import of Bun or its Drizzle driver',
    actual: Object.fromEntries(
      nodeSafe.map((subpath) => [
        subpath,
        bunChain(join(import.meta.dir, '..', exports[subpath]!)),
      ]),
    ),
    expected: Object.fromEntries(nodeSafe.map((subpath) => [subpath, null])),
  });
});
