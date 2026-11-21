import ts from 'typescript';

const digestModule = '@daisy/digest';

function literal(node: ts.Node | undefined, value: string): boolean {
  return (
    node !== undefined && ts.isStringLiteralLike(node) && node.text === value
  );
}

function method(
  node: ts.Node,
  name: string,
): node is ts.CallExpression & {
  expression: ts.PropertyAccessExpression;
} {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === name
  );
}

function replacement(node: ts.Node): ts.Expression | undefined {
  if (!method(node, 'digest') || !literal(node.arguments[0], 'hex')) return;
  const update = node.expression.expression;
  if (!method(update, 'update')) return;
  const hasher = update.expression.expression;
  if (!(ts.isCallExpression(hasher) || ts.isNewExpression(hasher))) return;
  if (
    !literal(hasher.arguments?.[0], 'sha3-256') ||
    hasher.arguments?.length !== 1 ||
    !/^(?:Bun\.)?(?:createHash|CryptoHasher)$/.test(hasher.expression.getText())
  )
    return;
  const [value, encoding] = update.arguments;
  if (encoding === undefined || literal(encoding, 'utf8')) return value;
}

function migrate(path: string, source: string): string {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const visit = (node: ts.Node) => {
    const value = replacement(node);
    if (value === undefined) ts.forEachChild(node, visit);
    else
      edits.push({
        start: node.getStart(file),
        end: node.end,
        text: `sha3Hex(${value.getText(file)})`,
      });
  };
  visit(file);
  if (edits.length === 0) return source;

  const rewritten = edits
    .reverse()
    .reduce(
      (text, edit) =>
        text.slice(0, edit.start) + edit.text + text.slice(edit.end),
      source,
    );
  // Remove the replaced Node and Bun names only if no identifier still uses them.
  const updated = ts.createSourceFile(
    path,
    rewritten,
    ts.ScriptTarget.Latest,
    true,
  );
  const uses = new Set<string>();
  const collect = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node)) uses.add(node.text);
    ts.forEachChild(node, collect);
  };
  collect(updated);
  const imports = updated.statements
    .filter(ts.isImportDeclaration)
    .flatMap((statement) => {
      if (
        !['node:crypto', 'crypto', 'bun'].some((name) =>
          literal(statement.moduleSpecifier, name),
        )
      )
        return [];
      const named = statement.importClause?.namedBindings;
      if (!named || !ts.isNamedImports(named)) return [];
      const keep = named.elements.filter(
        (item) =>
          !['createHash', 'CryptoHasher'].includes(
            (item.propertyName ?? item.name).text,
          ) || uses.has(item.name.text),
      );
      if (keep.length === named.elements.length) return [];
      if (keep.length === 0 && !statement.importClause?.name)
        return [
          {
            start: statement.getStart(updated),
            end: statement.end + Number(rewritten[statement.end] === '\n'),
            text: '',
          },
        ];
      if (keep.length === 0) return [];
      return [
        {
          start: named.getStart(updated),
          end: named.end,
          text: `{ ${keep.map((item) => item.getText(updated)).join(', ')} }`,
        },
      ];
    });
  const cleaned = imports
    .reverse()
    .reduce(
      (text, edit) =>
        text.slice(0, edit.start) + edit.text + text.slice(edit.end),
      rewritten,
    );
  const firstImport = updated.statements.find(ts.isImportDeclaration);
  const offset = firstImport?.getStart(updated) ?? 0;
  return `${cleaned.slice(0, offset)}import { sha3Hex } from '${digestModule}';\n${cleaned.slice(offset)}`;
}

if (import.meta.main) {
  const [mode, ...pathspecs] = process.argv.slice(2);
  if (mode !== '--check' && mode !== '--write')
    throw new Error(
      'Usage: bun scripts/migrate-sha3.ts --check|--write [git pathspecs]',
    );
  const files = Bun.spawnSync([
    'git',
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    ...pathspecs,
  ]);
  if (files.exitCode !== 0) throw new Error(files.stderr.toString());
  let changed = 0;
  for (const path of new Set(files.stdout.toString().split('\0'))) {
    if (path.startsWith('packages/digest/') || !/\.[cm]?[jt]sx?$/.test(path))
      continue;
    const file = Bun.file(path);
    if (!(await file.exists())) continue;
    const source = await file.text();
    if (!source.includes('sha3-256')) continue;
    const migrated = migrate(path, source);
    if (migrated === source) continue;
    changed++;
    if (mode === '--write') await Bun.write(path, migrated);
    else console.log(path);
  }
  console.log(
    `${changed} files ${mode === '--check' ? 'to migrate' : 'migrated'}`,
  );
  if (mode === '--check' && changed) process.exitCode = 1;
}
