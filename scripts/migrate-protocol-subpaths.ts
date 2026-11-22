import { writeFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import ts from 'typescript';
import {
  protocolBarrel,
  protocolPackage,
  protocolRootReferences,
  repositorySources,
} from './protocol-root';

const legacyRef = 'b02a631fd4c5240336b2aa75c9ede2e380a531e1';

export function protocolOwners(barrel: string) {
  const file = ts.createSourceFile(
    protocolBarrel,
    barrel,
    ts.ScriptTarget.Latest,
    true,
  );
  const owners = new Map<string, string>();
  for (const node of file.statements) {
    if (
      !ts.isExportDeclaration(node) ||
      !node.exportClause ||
      !ts.isNamedExports(node.exportClause) ||
      !node.moduleSpecifier ||
      !ts.isStringLiteral(node.moduleSpecifier) ||
      !node.moduleSpecifier.text.startsWith('./')
    )
      throw new Error(`Expected named owner re-exports: ${node.getText()}`);
    const target = `./src/${node.moduleSpecifier.text.slice(2)}.ts`;
    for (const element of node.exportClause.elements) {
      if (element.propertyName || owners.has(element.name.text))
        throw new Error(`Unexpected legacy export: ${element.getText()}`);
      owners.set(element.name.text, target);
    }
  }
  return owners;
}

function firstName(name: ts.EntityName): string {
  return ts.isQualifiedName(name) ? firstName(name.left) : name.text;
}

function destructuredNames(node: ts.CallExpression): string[] {
  const declaration = ts.isAwaitExpression(node.parent)
    ? node.parent.parent
    : node.parent;
  if (
    !ts.isVariableDeclaration(declaration) ||
    !ts.isObjectBindingPattern(declaration.name)
  )
    return [];
  return declaration.name.elements.map((element) =>
    !element.dotDotDotToken &&
    (!element.propertyName ||
      ts.isIdentifier(element.propertyName) ||
      ts.isStringLiteral(element.propertyName)) &&
    ts.isIdentifier(element.name)
      ? (element.propertyName ?? element.name).text
      : '',
  );
}

export function migrateProtocolSubpaths(
  path: string,
  source: string,
  owners: ReadonlyMap<string, string>,
  exports: Readonly<Record<string, string>>,
): string {
  const subpaths = new Map(
    Object.entries(exports)
      .filter(([key]) => key !== '.')
      .map(([key, target]) => [target, key]),
  );
  const edits = protocolRootReferences(path, source).map(
    ({ node, specifier }) => {
      const file = node.getSourceFile();
      const fail = (reason: string): never => {
        const { line } = file.getLineAndCharacterOfPosition(
          node.getStart(file),
        );
        throw new Error(`${path}:${line + 1}: ${reason}`);
      };
      const destination = (name: string) => {
        const target =
          owners.get(name) ?? fail(`unknown protocol export "${name}"`);
        if (specifier.text === protocolPackage) {
          const subpath =
            subpaths.get(target) ??
            fail(`missing protocol subpath for ${target}`);
          return protocolPackage + subpath.slice(1);
        }
        const relativePath = posix
          .relative(
            posix.dirname(path),
            posix.join('packages/protocol', target),
          )
          .replace(/\.ts$/, '');
        return relativePath.startsWith('.')
          ? relativePath
          : `./${relativePath}`;
      };
      const replace = (target: ts.Node, text: string) => ({
        start: target.getStart(file),
        end: target.getEnd(),
        text,
      });
      const quoted = (value: string) => {
        const quote = specifier.getText(file)[0];
        return `${quote}${value}${quote}`;
      };
      if (ts.isImportTypeNode(node) && node.qualifier)
        return replace(
          specifier,
          quoted(destination(firstName(node.qualifier))),
        );
      if (ts.isCallExpression(node)) {
        const names = destructuredNames(node);
        if (names.length && names.every(Boolean)) {
          const targets = new Set(names.map(destination));
          if (targets.size === 1)
            return replace(specifier, quoted([...targets][0]!));
        }
        return fail('destructure a single owner per protocol module load');
      }
      const bindings =
        ts.isImportDeclaration(node) && !node.importClause?.name
          ? node.importClause?.namedBindings
          : ts.isExportDeclaration(node)
            ? node.exportClause
            : undefined;
      if (
        !bindings ||
        !(ts.isNamedImports(bindings) || ts.isNamedExports(bindings))
      )
        return fail('use named protocol imports or re-exports');
      if (!bindings.elements.length || /\/\/|\/\*/.test(node.getText(file)))
        return fail('rewrite the empty or commented declaration explicitly');
      const groups = Map.groupBy(bindings.elements, (element) =>
        destination((element.propertyName ?? element.name).text),
      );
      if (groups.size === 1)
        return replace(specifier, quoted([...groups.keys()][0]!));
      const prefix = source.slice(node.getStart(file), bindings.getStart(file));
      const between = source.slice(bindings.end, specifier.getStart(file));
      const suffix = source.slice(specifier.end, node.end);
      return replace(
        node,
        [...groups]
          .map(
            ([target, elements]) =>
              `${prefix}{ ${elements.map((element) => element.getText(file)).join(', ')} }${between}${quoted(target)}${suffix}`,
          )
          .join('\n'),
      );
    },
  );
  return edits
    .sort((a, b) => b.start - a.start)
    .reduce(
      (text, edit) =>
        text.slice(0, edit.start) + edit.text + text.slice(edit.end),
      source,
    );
}

if (import.meta.main) {
  const [mode, ...pathspecs] = process.argv.slice(2);
  if (mode !== '--check' && mode !== '--write')
    throw new Error(
      'Usage: bun scripts/migrate-protocol-subpaths.ts --check|--write [git pathspecs]',
    );
  const cwd = resolve(import.meta.dir, '..');
  // Read the deleted named re-exports from the approved migration base so this
  // script can also move callers carried by branches cut before the sweep.
  const legacy = Bun.spawnSync(
    ['git', 'show', `${legacyRef}:${protocolBarrel}`],
    { cwd },
  );
  if (legacy.exitCode !== 0)
    throw new Error(
      `Fetch the full migration base ${legacyRef}: ${legacy.stderr.toString()}`,
    );
  const owners = protocolOwners(legacy.stdout.toString());
  const { exports } = await Bun.file(
    resolve(cwd, 'packages/protocol/package.json'),
  ).json();
  const edits = [];
  for (const { path, absolutePath, source } of repositorySources(
    cwd,
    pathspecs,
  )) {
    if (path === protocolBarrel) continue;
    const migrated = migrateProtocolSubpaths(path, source, owners, exports);
    if (migrated !== source) edits.push({ path, absolutePath, migrated });
  }
  for (const { path, absolutePath, migrated } of edits) {
    if (mode === '--write') writeFileSync(absolutePath, migrated);
    else console.log(path);
  }
  console.log(
    `${edits.length} files ${mode === '--write' ? 'migrated' : 'to migrate'}`,
  );
  if (mode === '--check' && edits.length) process.exitCode = 1;
}
