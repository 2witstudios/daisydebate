import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

/** The sweeps need lexical bindings from this file, without loading its dependencies. */
export const sourceChecker = (file: ts.SourceFile) =>
  ts
    .createProgram(
      [file.fileName],
      { allowJs: true, noLib: true, noResolve: true },
      {
        ...ts.createCompilerHost({}),
        getSourceFile: (name) => (name === file.fileName ? file : undefined),
      },
    )
    .getTypeChecker();

export function unparenthesized(node: ts.Node): ts.Node {
  let value: ts.Node = node;
  while (ts.isParenthesizedExpression(value)) value = value.expression;
  return value;
}

export const isGlobal = (
  checker: ts.TypeChecker,
  node: ts.Node,
  name: string,
) =>
  ts.isIdentifier(node) &&
  node.text === name &&
  !checker.getSymbolAtLocation(node)?.declarations?.length;

export function constInitializer(
  checker: ts.TypeChecker,
  node: ts.Node,
  seen: Set<ts.Symbol>,
): ts.Expression | undefined {
  if (!ts.isIdentifier(node)) return;
  const symbol = checker.getSymbolAtLocation(node);
  const declaration =
    symbol?.valueDeclaration ??
    symbol?.declarations?.find(ts.isVariableDeclaration);
  if (
    !symbol ||
    seen.has(symbol) ||
    !declaration ||
    !ts.isVariableDeclaration(declaration) ||
    !(declaration.parent.flags & ts.NodeFlags.Const)
  )
    return;
  seen.add(symbol);
  return declaration.initializer;
}

export function staticText(
  checker: ts.TypeChecker,
  node: ts.Node,
  seen = new Set<ts.Symbol>(),
): string | undefined {
  const value = unparenthesized(node);
  if (ts.isStringLiteralLike(value)) return value.text;
  const initializer = constInitializer(checker, value, seen);
  if (initializer) return staticText(checker, initializer, seen);
}

export function memberName(
  checker: ts.TypeChecker,
  node: ts.Node,
): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node))
    return staticText(checker, node.argumentExpression);
}

export function hasOtherDeclaration(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  name: ts.Identifier,
): boolean {
  const scan = (node: ts.Node): boolean | undefined =>
    (ts.isIdentifier(node) &&
      node !== name &&
      node.text === name.text &&
      checker
        .getSymbolAtLocation(node)
        ?.declarations?.some((declaration) => declaration === node.parent)) ||
    ts.forEachChild(node, scan);
  return scan(file) === true;
}

export function usesCommonJs(
  checker: ts.TypeChecker,
  file: ts.SourceFile,
): boolean {
  const isCommonJsName = (expression: ts.Node, name: string): boolean => {
    const node = unparenthesized(expression);
    if (!ts.isIdentifier(node) || node.text !== name) return false;
    const symbol = checker
      .getSymbolsInScope(node, ts.SymbolFlags.Value | ts.SymbolFlags.Alias)
      .find((binding) => binding.name === name);
    // TypeScript creates a synthetic module binding from the export receiver itself.
    return !symbol?.declarations?.some(
      (declaration) =>
        !ts.isIdentifier(declaration) ||
        !(
          ts.isPropertyAccessExpression(declaration.parent) ||
          ts.isElementAccessExpression(declaration.parent)
        ) ||
        declaration.parent.expression !== declaration,
    );
  };
  const visit = (node: ts.Node): boolean | undefined => {
    if (ts.isCallExpression(node) && isCommonJsName(node.expression, 'require'))
      return true;
    if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      (isCommonJsName(node.expression, 'exports') ||
        (isCommonJsName(node.expression, 'module') &&
          memberName(checker, node) === 'exports'))
    )
      return true;
    return ts.forEachChild(node, visit);
  };
  return /\.c[jt]s$/.test(file.fileName) || visit(file) === true;
}

/** The nearest manifest determines the format of files without an explicit module suffix. */
export function declaredCommonJs(path: string): boolean {
  if (!/\.[jt]sx?$/.test(path)) return false;
  let directory = dirname(resolve(path));
  while (true) {
    const manifest = join(directory, 'package.json');
    if (existsSync(manifest))
      return JSON.parse(readFileSync(manifest, 'utf8')).type === 'commonjs';
    const parent = dirname(directory);
    if (parent === directory) return false;
    directory = parent;
  }
}
