import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import ts from 'typescript';

const legacyParam =
  /new URL\(request\.url\)\.pathname\.split\('\/'\)\[(\d+)\] \?\? ''/g;

/** Converts the standard one-param route binding. Leaves custom handlers for the lint gate. */
export function migrateRouteParams(file: string, source: string): string {
  const parts = file
    .split('/')
    .filter((part) => !/^\(.*\)$/.test(part) && !part.startsWith('@'));
  if (parts.pop() !== 'route.ts') return source;
  const dynamic = parts.flatMap((segment, offset) => {
    const name = /^\[(\w+)\]$/.exec(segment)?.[1];
    return name === undefined ? [] : [{ name, index: offset + 1 }];
  });
  const [param] = dynamic;
  if (
    dynamic.length !== 1 ||
    param === undefined ||
    parts.filter((part) => part.startsWith('[')).length !== 1
  )
    return source;

  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const bindings = tree.statements
    .filter(ts.isVariableStatement)
    .flatMap(({ declarationList }) => declarationList.declarations)
    .flatMap(({ initializer }) => {
      if (
        initializer === undefined ||
        !ts.isCallExpression(initializer) ||
        initializer.expression.getText(tree) !== 'processRoute'
      )
        return [];
      return [initializer];
    });
  if (bindings.length === 0) return source;

  const edits = bindings.flatMap((binding) => {
    const original = binding.getText(tree);
    const matches = [...original.matchAll(legacyParam)];
    const [match] = matches;
    if (
      matches.length !== 1 ||
      match?.[1] !== String(param.index) ||
      !original.includes('(request) =>')
    )
      return [];
    return [
      {
        start: binding.getStart(tree),
        end: binding.getEnd(),
        replacement: original
          .replace('processRoute(', 'processRouteWithParams<Params>(')
          .replace('(request) =>', `(request, { ${param.name} }) =>`)
          .replace(legacyParam, param.name),
      },
    ];
  });
  if (edits.length !== bindings.length) return source;
  const importRoute =
    /^import \{ processRoute \} from ('[^']+\/server\/process-app');$/m;
  if (!importRoute.test(source)) return source;
  const updated = edits
    .reverse()
    .reduce(
      (text, edit) =>
        text.slice(0, edit.start) + edit.replacement + text.slice(edit.end),
      source,
    );
  const path = `/${parts.join('/')}`;
  return updated.replace(
    importRoute,
    `import { processRouteWithParams } from $1;\n\ntype Params = Awaited<RouteContext<'${path}'>['params']>;`,
  );
}

if (import.meta.main) {
  const app = process.argv[2] ?? 'apps/web/src/app';
  let changed = 0;
  for (const file of await readdir(app, { recursive: true })) {
    if (!file.endsWith('/route.ts')) continue;
    const path = join(app, file);
    const source = await Bun.file(path).text();
    const next = migrateRouteParams(file, source);
    if (next === source) continue;
    await Bun.write(path, next);
    changed += 1;
  }
  console.log(`Migrated ${changed} route files.`);
}
