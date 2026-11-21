// Who imports each export: the proof `policy/planned-readers.json` is judged
// by (ADR 0057). A declared export that shipping source imports has its
// reader, and one nothing imports is dead code, not a foundation; either way
// the declaration goes. A barrel's `export … from` is followed to the module
// that declares the name, so an import through `@daisy/protocol` reaches the
// file behind it.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import * as ts from 'typescript';

const root = resolve(import.meta.dir, '..');

/** One module's imports and re-exports, by specifier. */
type ModuleLinks = {
  /** Names imported per specifier; `*` is the whole module. */
  readonly imports: readonly (readonly [string, readonly string[]])[];
  /** `export { local as name } from …`: name → [specifier, local]. */
  readonly reexports: ReadonlyMap<string, readonly [string, string]>;
  /** `export * from …` specifiers. */
  readonly stars: readonly string[];
};

const importedNames = (clause: ts.ImportClause | undefined) => {
  const bindings = clause?.namedBindings;
  const names = clause?.name ? ['default'] : [];
  if (bindings === undefined) return names;
  return ts.isNamespaceImport(bindings)
    ? [...names, '*']
    : [
        ...names,
        ...bindings.elements.map(
          (element) => (element.propertyName ?? element.name).text,
        ),
      ];
};

/** The exported name at the beginning of a qualified import type. */
const firstName = (name: ts.EntityName): string =>
  ts.isQualifiedName(name) ? firstName(name.left) : name.text;

/** The imports and re-exports of one source file, read from its AST. */
export function moduleLinks(path: string, source: string): ModuleLinks {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports: (readonly [string, readonly string[]])[] = [];
  const reexports = new Map<string, readonly [string, string]>();
  const stars: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push([
        node.moduleSpecifier.text,
        importedNames(node.importClause),
      ]);
    else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      const clause = node.exportClause;
      if (clause === undefined) stars.push(specifier);
      else if (ts.isNamedExports(clause))
        for (const element of clause.elements)
          reexports.set(element.name.text, [
            specifier,
            (element.propertyName ?? element.name).text,
          ]);
      else reexports.set(clause.name.text, [specifier, '*']);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      imports.push([
        node.argument.literal.text,
        [node.qualifier === undefined ? '*' : firstName(node.qualifier)],
      ]);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteralLike(node.arguments[0])
    )
      imports.push([node.arguments[0].text, ['*']]);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { imports, reexports, stars };
}

type Manifest = { name?: string; exports?: unknown };

/** Every workspace's package name, mapped to its folder and its export map. */
function workspaceExports(): ReadonlyMap<
  string,
  { readonly folder: string; readonly exports: unknown }
> {
  const workspaces = new Map<
    string,
    { readonly folder: string; readonly exports: unknown }
  >();
  for (const group of ['apps', 'packages'])
    for (const folder of new Bun.Glob(`${group}/*/package.json`).scanSync(
      root,
    )) {
      const manifest = JSON.parse(
        readFileSync(join(root, folder), 'utf8'),
      ) as Manifest;
      if (manifest.name)
        workspaces.set(manifest.name, {
          folder: dirname(folder),
          exports: manifest.exports,
        });
    }
  return workspaces;
}

const sourceCandidates = (base: string) => [
  base,
  `${base}.ts`,
  `${base}.tsx`,
  join(base, 'index.ts'),
  join(base, 'index.tsx'),
];

const isFile = (path: string) => existsSync(path) && statSync(path).isFile();

/** The repository path a specifier names from `importer`, or null if outside. */
function resolveSpecifier(
  specifier: string,
  importer: string,
  workspaces: ReturnType<typeof workspaceExports>,
): string | null {
  if (specifier.startsWith('.')) {
    const base = join(root, dirname(importer), specifier);
    const found = sourceCandidates(base).find(isFile);
    return found === undefined ? null : relative(root, found);
  }
  const parts = specifier.split('/');
  const name = specifier.startsWith('@')
    ? parts.slice(0, 2).join('/')
    : parts[0];
  const workspace = name === undefined ? undefined : workspaces.get(name);
  if (workspace === undefined) return null;
  const subpath = `.${specifier.slice(name?.length ?? 0)}`;
  const exports = workspace.exports;
  const target =
    typeof exports === 'object' && exports !== null
      ? (exports as Record<string, unknown>)[subpath]
      : undefined;
  return typeof target === 'string'
    ? posix.normalize(posix.join(workspace.folder, target))
    : null;
}

/**
 * Each `path|export` an import reaches, mapped to the files that import it,
 * keyed as `policy/planned-readers.json` names a declaration. A namespace
 * import is keyed `path|*`.
 */
export function collectImporters(
  files: readonly string[],
): ReadonlyMap<string, readonly string[]> {
  const workspaces = workspaceExports();
  const links = new Map<string, ModuleLinks>();
  for (const file of files) {
    if (!/\.tsx?$/.test(file)) continue;
    const path = relative(root, file);
    links.set(path, moduleLinks(path, readFileSync(file, 'utf8')));
  }
  const origins = (
    path: string,
    name: string,
    seen: Set<string>,
  ): readonly string[] => {
    const key = `${path}|${name}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const module = links.get(path);
    if (module === undefined) return [key];
    const named = module.reexports.get(name);
    const reexports =
      named === undefined
        ? [
            ...(name === '*' ? module.reexports.values() : []),
            ...module.stars.map((specifier) => [specifier, name] as const),
          ]
        : [named];
    return [
      key,
      ...reexports.flatMap(([specifier, exported]) => {
        const target = resolveSpecifier(specifier, path, workspaces);
        return target === null ? [] : origins(target, exported, seen);
      }),
    ];
  };
  const readers = new Map<string, string[]>();
  for (const [importer, module] of links) {
    for (const [specifier, names] of module.imports) {
      const target = resolveSpecifier(specifier, importer, workspaces);
      if (target === null) continue;
      for (const name of names)
        for (const origin of origins(target, name, new Set()))
          readers.set(origin, [...(readers.get(origin) ?? []), importer]);
    }
  }
  return readers;
}
