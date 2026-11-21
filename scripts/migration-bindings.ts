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
  const declaration = symbol?.valueDeclaration;
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
