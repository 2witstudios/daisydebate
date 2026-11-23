import ts from 'typescript';
import { isGlobal, sourceChecker } from './migration-bindings';

/**
 * Every module a source loads, by any spelling the compiler reads as one:
 * static and type imports, re-exports, `import x = require()`, ambient module
 * declarations, dynamic `import()` and the global `require()`, through
 * parentheses, casts and escapes.
 */

function unwrapExpression(node: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    node = node.expression;
  return node;
}

function moduleSpecifier(node: ts.Node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
    return node.moduleSpecifier;
  if (ts.isExternalModuleReference(node)) return node.expression;
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
    return node.argument.literal;
  if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name))
    return node.name;
  if (ts.isCallExpression(node) && node.arguments[0])
    return unwrapExpression(node.arguments[0]);
}

/** The module loads in `source` whose decoded specifier `matches` accepts. */
export function moduleLoads(
  path: string,
  source: string,
  matches: (specifier: string) => boolean,
) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const references: { node: ts.Node; specifier: ts.StringLiteralLike }[] = [];
  let checker: ts.TypeChecker | undefined;
  const isModuleLoad = (node: ts.Node) => {
    if (!ts.isCallExpression(node)) return true;
    const callee = unwrapExpression(node.expression);
    return (
      callee.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(callee) &&
        callee.text === 'require' &&
        isGlobal((checker ??= sourceChecker(file)), callee, 'require'))
    );
  };
  const visit = (node: ts.Node) => {
    const specifier = moduleSpecifier(node);
    if (
      specifier &&
      ts.isStringLiteralLike(specifier) &&
      matches(specifier.text) &&
      isModuleLoad(node)
    )
      references.push({ node, specifier });
    ts.forEachChild(node, visit);
  };
  visit(file);
  return references;
}
