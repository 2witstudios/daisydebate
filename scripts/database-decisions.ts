import { posix } from 'node:path';
import ts from 'typescript';

/**
 * R4.4: `packages/db` stores and reads; it does not decide. A production
 * module of the package that exports a function must touch storage: use a
 * value from PostgreSQL's client, Drizzle, or one of the package's own
 * storage primitives (its tables, its transaction, its query, its bounded
 * transaction runner or its lanes), or take and use a parameter they type. A module that touches none of them is a
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

/**
 * The package's storage handles, which a parameter may be typed by: a
 * transaction, its opener or runner, a bounded transaction, a lane. Any type
 * from Bun's client or Drizzle is a handle too. A vocabulary type (a lane's
 * name, a table's row) is not: a rule over a row is still a pure rule.
 */
const packageHandles: Readonly<Record<string, readonly string[]>> = {
  [`${databaseSource}tx`]: ['Tx', 'TxSource', 'TxOpener', 'TransactionRunner'],
  [`${databaseSource}bounded-transaction`]: ['BoundedTransaction'],
  [`${databaseSource}workload`]: ['Lane', 'LaneGate', 'LaneConnector'],
};

const isHandleType = (path: string, specifier: string, name: string) => {
  if (!specifier.startsWith('.')) return storagePackages(specifier);
  const target = posix
    .normalize(posix.join(posix.dirname(path), specifier))
    .replace(/\.[jt]s$/, '')
    .replace(/\/index$/, '');
  return packageHandles[target]?.includes(name) ?? false;
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

const isTypePosition = (node: ts.Node): boolean => {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isTypeNode(at) || ts.isTypeAliasDeclaration(at)) return true;
    if (ts.isInterfaceDeclaration(at) || ts.isImportDeclaration(at))
      return true;
    if (ts.isExportDeclaration(at)) return true;
  }
  return false;
};

/** An identifier read as a value: not a declaration, a type, or a property name. */
const isValueReference = (node: ts.Identifier) => {
  const parent = node.parent;
  if (isTypePosition(node)) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node)
    return false;
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent)) &&
    parent.name === node
  )
    return false;
  if (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent)) &&
    parent.name === node
  )
    return false;
  return true;
};

const boundNames = (name: ts.BindingName): string[] =>
  ts.isIdentifier(name)
    ? [name.text]
    : name.elements.flatMap((element) =>
        ts.isOmittedExpression(element) ? [] : boundNames(element.name),
      );

const referencesIn = (node: ts.Node, names: ReadonlySet<string>) => {
  let found = false;
  const visit = (child: ts.Node) => {
    if (found) return;
    if (
      ts.isIdentifier(child) &&
      names.has(child.text) &&
      isValueReference(child)
    )
      found = true;
    else ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
};

/**
 * Whether a module touches storage: it reads a value it imported from a
 * storage primitive (a table, `sql`, `query`, the transaction opener, a lane),
 * or one of its functions takes a parameter typed by a storage primitive (a
 * transaction, a connection, a transaction runner) and uses it. A type-only
 * or unused import of a primitive touches nothing.
 */
function touchesStorage(path: string, file: ts.SourceFile): boolean {
  const values = new Set<string>();
  const types = new Set<string>();
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !isStoragePrimitive(path, statement.moduleSpecifier.text) ||
      !statement.importClause
    )
      continue;
    const clause = statement.importClause;
    const specifier = statement.moduleSpecifier.text;
    const into = (local: string, imported: string, typeOnly: boolean) => {
      if (!typeOnly && !clause.isTypeOnly) values.add(local);
      if (isHandleType(path, specifier, imported)) types.add(local);
    };
    if (clause.name) into(clause.name.text, 'default', false);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings))
      into(bindings.name.text, '*', false);
    if (bindings && ts.isNamedImports(bindings))
      for (const element of bindings.elements)
        into(
          element.name.text,
          (element.propertyName ?? element.name).text,
          element.isTypeOnly,
        );
  }
  if (values.size && referencesIn(file, values)) return true;
  const storageTypes = new Set(types);
  const typedByStorage = (type: ts.Node | undefined) => {
    let found = false;
    const visit = (node: ts.Node) => {
      if (found) return;
      if (
        ts.isTypeReferenceNode(node) &&
        storageTypes.has(
          ts.isIdentifier(node.typeName)
            ? node.typeName.text
            : leftmost(node.typeName),
        )
      )
        found = true;
      else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal) &&
        isHandleType(
          path,
          node.argument.literal.text,
          node.qualifier ? leftmost(node.qualifier) : 'default',
        )
      )
        found = true;
      else ts.forEachChild(node, visit);
    };
    if (type) visit(type);
    return found;
  };
  // A type this module declares from a storage type is one too (`TxOpener`).
  for (let grew = true; grew;) {
    grew = false;
    for (const statement of file.statements)
      if (
        (ts.isTypeAliasDeclaration(statement) ||
          ts.isInterfaceDeclaration(statement)) &&
        !storageTypes.has(statement.name.text) &&
        typedByStorage(statement)
      ) {
        storageTypes.add(statement.name.text);
        grew = true;
      }
  }
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isFunctionLike(node) && 'body' in node && node.body) {
      const names = new Set(
        node.parameters
          .filter((parameter) => typedByStorage(parameter.type))
          .flatMap((parameter) => boundNames(parameter.name)),
      );
      if (names.size && referencesIn(node.body, names)) found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const leftmost = (name: ts.EntityName): string =>
  ts.isIdentifier(name) ? name.text : leftmost(name.left);

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
  if (!functions.length || touchesStorage(path, file)) return null;
  return `${path}: exports ${functions.join(', ')} and touches no table, connection, transaction or query; a pure rule belongs to its owner (engine, protocol or the owning feature), not packages/db (R4.4)`;
}
