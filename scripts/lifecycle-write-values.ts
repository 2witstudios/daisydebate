import { posix } from 'node:path';
import ts from 'typescript';

export type ReadModule = (path: string) => ts.SourceFile | undefined;

type Binding = ts.Expression | ts.FunctionDeclaration;

const declared = (
  statements: ts.NodeArray<ts.Statement>,
  name: string,
): Binding | undefined => {
  for (const statement of statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name)
      return statement;
    if (!ts.isVariableStatement(statement)) continue;
    const variable = statement.declarationList.declarations.find(
      (item) => ts.isIdentifier(item.name) && item.name.text === name,
    );
    if (variable) return variable.initializer;
  }
  return undefined;
};

export function bindingOf(
  node: ts.Identifier,
  readModule: ReadModule,
): Binding | undefined {
  for (
    let scope: ts.Node | undefined = node.parent;
    scope;
    scope = scope.parent
  ) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    const local = declared(scope.statements, node.text);
    if (local) return local;
  }
  const source = node.getSourceFile();
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    )
      continue;
    const specifier = statement.moduleSpecifier.text;
    const imports = statement.importClause?.namedBindings;
    if (!specifier.startsWith('.') || !imports || !ts.isNamedImports(imports))
      continue;
    const named = imports.elements.find(({ name }) => name.text === node.text);
    if (!named) continue;
    const base = posix.join(posix.dirname(source.fileName), specifier);
    const target =
      readModule(`${base}.ts`) ??
      readModule(`${base}/index.ts`) ??
      readModule(base);
    if (target)
      return declared(
        target.statements,
        (named.propertyName ?? named.name).text,
      );
  }
  return undefined;
}

const unwrap = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node) ||
  ts.isAsExpression(node) ||
  ts.isSatisfiesExpression(node) ||
  ts.isTypeAssertionExpression(node) ||
  ts.isNonNullExpression(node)
    ? unwrap(node.expression)
    : node;

export function literalValues(
  input: ts.Expression,
  readModule: ReadModule,
): readonly string[] {
  const seen = new Set<ts.Expression>();
  function visit(node: ts.Expression): readonly string[] {
    const value = unwrap(node);
    if (seen.has(value)) return [];
    seen.add(value);
    if (ts.isStringLiteralLike(value)) return [value.text];
    if (ts.isConditionalExpression(value))
      return [value.whenTrue, value.whenFalse].flatMap(visit);
    if (ts.isArrayLiteralExpression(value))
      return value.elements.flatMap(visit);
    if (ts.isIdentifier(value)) {
      const binding = bindingOf(value, readModule);
      if (binding && !ts.isFunctionDeclaration(binding)) return visit(binding);
    }
    return [];
  }
  return visit(input);
}

const resultsOf = (binding: Binding | undefined): readonly ts.Expression[] => {
  if (
    !binding ||
    !(
      ts.isArrowFunction(binding) ||
      ts.isFunctionExpression(binding) ||
      ts.isFunctionDeclaration(binding)
    )
  )
    return [];
  const body = binding.body;
  if (!body) return [];
  if (!ts.isBlock(body)) return [body];
  const results: ts.Expression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression)
      results.push(node.expression);
    else ts.forEachChild(node, visit);
  };
  visit(body);
  return results;
};

/**
 * Follow row values before they reach the SQL builder, including local
 * helper imports: each literal written to one of `keys`, with its key.
 */
export function writtenValues(
  input: ts.Expression,
  readModule: ReadModule,
  keys: ReadonlySet<string>,
): readonly (readonly [key: string, value: string])[] {
  const seen = new Set<ts.Expression>();
  function visit(
    node: ts.Expression,
  ): readonly (readonly [key: string, value: string])[] {
    const value = unwrap(node);
    if (seen.has(value)) return [];
    seen.add(value);
    if (ts.isConditionalExpression(value))
      return [value.whenTrue, value.whenFalse].flatMap(visit);
    if (ts.isArrayLiteralExpression(value))
      return value.elements.flatMap(visit);
    if (ts.isIdentifier(value)) {
      const binding = bindingOf(value, readModule);
      return binding && !ts.isFunctionDeclaration(binding)
        ? visit(binding)
        : [];
    }
    if (ts.isCallExpression(value) && ts.isIdentifier(value.expression))
      return resultsOf(bindingOf(value.expression, readModule)).flatMap(visit);
    if (!ts.isObjectLiteralExpression(value)) return [];
    return value.properties.flatMap((property) => {
      if (ts.isSpreadAssignment(property)) return visit(property.expression);
      if (!ts.isPropertyAssignment(property)) return [];
      if (
        !ts.isIdentifier(property.name) &&
        !ts.isStringLiteralLike(property.name)
      )
        return [];
      const key = property.name.text;
      return keys.has(key)
        ? literalValues(property.initializer, readModule).map(
            (value) => [key, value] as const,
          )
        : [];
    });
  }
  return visit(input);
}
