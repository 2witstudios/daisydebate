import { posix } from 'node:path';
import ts from 'typescript';
import { moduleLoads } from './module-loads';

/**
 * R4.4: `packages/db` stores and reads; it does not decide. A production
 * module of the package that exports a function must touch storage: load
 * PostgreSQL's client, Drizzle, or one of the package's own storage
 * primitives (its tables, its transaction, its query, its bounded
 * transaction runner or its lanes). A module that touches none of them is a
 * pure function file, and its rule belongs to the owner of the rule: the
 * engine, the protocol or the application feature.
 */
const databaseSource = 'packages/db/src/';

const storagePackages = (name: string) =>
  name === 'bun' ||
  name === 'drizzle-orm' ||
  name.startsWith('drizzle-orm/') ||
  name === '@better-auth/drizzle-adapter';

/** The package's storage primitives, each by what it is. */
const storagePrimitives = [
  'schema/',
  'tx',
  'raw-rows',
  'bounded-transaction',
  'workload',
].map((name) => `${databaseSource}${name}`);

const isProductionModule = (path: string) =>
  path.startsWith(databaseSource) &&
  /\.ts$/.test(path) &&
  !/\.test\.ts$|\.test-support\.ts$|\.d\.ts$/.test(path) &&
  !path.startsWith(`${databaseSource}schema/`);

const isStoragePrimitive = (path: string, specifier: string) => {
  if (!specifier.startsWith('.')) return storagePackages(specifier);
  const target = posix
    .normalize(posix.join(posix.dirname(path), specifier))
    .replace(/\.[jt]s$/, '')
    .replace(/\/index$/, '');
  return storagePrimitives.some((primitive) =>
    primitive.endsWith('/')
      ? `${target}/`.startsWith(primitive)
      : target === primitive,
  );
};

const unwrap = (node: ts.Expression): ts.Expression => {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isTypeAssertionExpression(node)
  )
    node = node.expression;
  return node;
};

const isCallable = (node: ts.Expression): boolean => {
  const value = unwrap(node);
  return (
    ts.isArrowFunction(value) ||
    ts.isFunctionExpression(value) ||
    ts.isClassExpression(value) ||
    (ts.isObjectLiteralExpression(value) &&
      value.properties.some(
        (property) =>
          ts.isMethodDeclaration(property) ||
          (ts.isPropertyAssignment(property) &&
            isCallable(property.initializer)),
      ))
  );
};

const isExported = (node: ts.Node) =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );

/** The names of the functions, classes and function namespaces a module exports. */
function exportedFunctions(file: ts.SourceFile): string[] {
  const local = new Map<string, boolean>();
  const names: string[] = [];
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      local.set(statement.name.text, true);
      if (isExported(statement)) names.push(statement.name.text);
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      local.set(statement.name.text, true);
      if (isExported(statement)) names.push(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
          continue;
        const callable = isCallable(declaration.initializer);
        local.set(declaration.name.text, callable);
        if (callable && isExported(statement))
          names.push(declaration.name.text);
      }
    } else if (
      ts.isExportAssignment(statement) &&
      isCallable(statement.expression)
    ) {
      names.push('default');
    }
  }
  for (const statement of file.statements)
    if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      !statement.isTypeOnly &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    )
      for (const element of statement.exportClause.elements)
        if (
          !element.isTypeOnly &&
          local.get((element.propertyName ?? element.name).text)
        )
          names.push(element.name.text);
  return names;
}

/**
 * The issue for a `packages/db` module that exports a function and touches
 * no storage, or null. Tests, test support and schema files are not read.
 */
export function pureDatabaseModuleIssue(
  path: string,
  source: string,
): string | null {
  if (!isProductionModule(path)) return null;
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const functions = exportedFunctions(file);
  if (!functions.length) return null;
  if (
    moduleLoads(path, source, (specifier) =>
      isStoragePrimitive(path, specifier),
    ).length
  )
    return null;
  return `${path}: exports ${functions.join(', ')} and touches no table, connection, transaction or query; a pure rule belongs to its owner (engine, protocol or the owning feature), not packages/db (R4.4)`;
}
