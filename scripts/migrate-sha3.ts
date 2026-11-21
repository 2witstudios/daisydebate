import ts from 'typescript';
import {
  constInitializer,
  hasOtherDeclaration,
  isGlobal,
  memberName,
  sourceChecker,
  staticText,
  unparenthesized,
} from './migration-bindings';

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

function importedFrom(declaration: ts.Node) {
  let node: ts.Node | undefined = declaration;
  while (node && !ts.isImportDeclaration(node)) node = node.parent;
  return node && ts.isStringLiteral(node.moduleSpecifier)
    ? node.moduleSpecifier.text
    : undefined;
}

function isNativeHasher(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  seen = new Set<ts.Symbol>(),
): boolean {
  const node = unparenthesized(expression);
  if (ts.isIdentifier(node)) {
    const declaration = checker.getSymbolAtLocation(node)?.declarations?.[0];
    if (declaration && ts.isImportSpecifier(declaration)) {
      const name = (declaration.propertyName ?? declaration.name).text;
      const source = importedFrom(declaration);
      return (
        (name === 'createHash' &&
          (source === 'crypto' || source === 'node:crypto')) ||
        (name === 'CryptoHasher' && source === 'bun')
      );
    }
    const initializer = constInitializer(checker, node, seen);
    return (
      initializer !== undefined && isNativeHasher(checker, initializer, seen)
    );
  }
  if (
    !ts.isPropertyAccessExpression(node) &&
    !ts.isElementAccessExpression(node)
  )
    return false;
  const name = memberName(checker, node);
  const owner = unparenthesized(node.expression);
  if (name === 'CryptoHasher' && isGlobal(checker, owner, 'Bun')) return true;
  const declaration = checker.getSymbolAtLocation(owner)?.declarations?.[0];
  if (
    !declaration ||
    !(ts.isNamespaceImport(declaration) || ts.isImportClause(declaration))
  )
    return false;
  const source = importedFrom(declaration);
  return (
    (name === 'createHash' &&
      (source === 'crypto' || source === 'node:crypto')) ||
    (name === 'CryptoHasher' && source === 'bun')
  );
}

function replacement(
  checker: ts.TypeChecker,
  node: ts.Node,
): ts.Expression | undefined {
  if (!method(node, 'digest') || !literal(node.arguments[0], 'hex')) return;
  const update = node.expression.expression;
  if (!method(update, 'update')) return;
  const hasher = update.expression.expression;
  if (!(ts.isCallExpression(hasher) || ts.isNewExpression(hasher))) return;
  if (
    hasher.arguments?.length !== 1 ||
    staticText(checker, hasher.arguments[0]!)?.toLowerCase() !== 'sha3-256' ||
    !isNativeHasher(checker, hasher.expression)
  )
    return;
  const [value, encoding] = update.arguments;
  if (encoding === undefined || literal(encoding, 'utf8')) return value;
}

function digestImports(file: ts.SourceFile): ts.NamedImports | undefined {
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !literal(statement.moduleSpecifier, digestModule) ||
      statement.importClause?.isTypeOnly
    )
      continue;
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) return named;
  }
}

export function migrateSha3(path: string, source: string): string {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const checker = sourceChecker(file);
  const existing = digestImports(file)?.elements.find(
    (item) =>
      !item.isTypeOnly &&
      !hasOtherDeclaration(checker, file, item.name) &&
      (item.propertyName ?? item.name).text === 'sha3Hex',
  );
  let local = existing?.name.text ?? 'sha3Hex';
  if (!existing && /\bsha3Hex\b/.test(source)) {
    local = 'sharedSha3Hex';
    for (let suffix = 2; new RegExp(`\\b${local}\\b`).test(source); suffix++)
      local = `sharedSha3Hex${suffix}`;
  }
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const visit = (node: ts.Node) => {
    const value = replacement(checker, node);
    if (value === undefined) ts.forEachChild(node, visit);
    else
      edits.push({
        start: node.getStart(file),
        end: node.end,
        text: `${local}(${value.getText(file)})`,
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
  const updatedChecker = sourceChecker(updated);
  const uses = new Set<ts.Symbol>();
  const collect = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node)) {
      const symbol = updatedChecker.getSymbolAtLocation(node);
      if (symbol) uses.add(symbol);
    }
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
          ) || uses.has(updatedChecker.getSymbolAtLocation(item.name)!),
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
  if (!existing) {
    const imported = local === 'sha3Hex' ? local : `sha3Hex as ${local}`;
    const named = digestImports(updated);
    if (named) {
      const first = named.elements[0];
      const at = first?.getStart(updated) ?? named.getStart(updated) + 1;
      imports.push({
        start: at,
        end: at,
        text: first ? `${imported}, ` : ` ${imported} `,
      });
    } else {
      const firstCode = updated.statements.find(
        (statement) =>
          !ts.isExpressionStatement(statement) ||
          !ts.isStringLiteral(statement.expression),
      );
      const at = firstCode?.getStart(updated) ?? rewritten.length;
      imports.push({
        start: at,
        end: at,
        text: `import { ${imported} } from '${digestModule}';\n`,
      });
    }
  }
  const migrated = imports
    .sort((a, b) => b.start - a.start || b.end - a.end)
    .reduce(
      (text, edit) =>
        text.slice(0, edit.start) + edit.text + text.slice(edit.end),
      rewritten,
    );
  return migrateSha3(path, migrated);
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
    const migrated = migrateSha3(path, source);
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
