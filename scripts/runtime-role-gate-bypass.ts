import ts from 'typescript';

// What start.ts, and every module it loads outside listen-first.ts's own
// imports, must never do itself (scripts/runtime-role-gate.ts): compose,
// prepare or listen by any access form, or load code through a dynamic
// import, the real CommonJS require, eval or Function.

/** Members start.ts must never touch itself, by any access form. */
const BYPASS_MEMBERS = new Map([
  ['listen', '.listen('],
  ['prepare', 'nextApp.prepare('],
  ['getRequestHandler', 'getRequestHandler('],
]);

/** A module-loading or gate-bypassing step start.ts must never take
 * itself, as the token it reports (ISSUE-193, ISSUE-222, ISSUE-224,
 * ISSUE-227, ISSUE-228). */
export const bypassToken = (
  checker: ts.TypeChecker,
  node: ts.Node,
): string | null => {
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword
  )
    return 'import(';
  if (
    (ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)) ||
    (ts.isImportSpecifier(node) &&
      (node.propertyName ?? node.name).text === 'require')
  )
    return 'require(';
  if (ts.isIdentifier(node)) return identifierBypass(checker, node);
  const member = memberName(node);
  if (member === 'require') return requireMember(checker, node);
  return (member !== undefined && BYPASS_MEMBERS.get(member)) || null;
};

/** Globals that load or evaluate code when referenced as values. */
const LOADERS = new Map([
  ['require', 'require('],
  ['eval', 'eval('],
  ['Function', 'Function('],
]);

const identifierBypass = (
  checker: ts.TypeChecker,
  node: ts.Identifier,
): string | null => {
  if (node.text === 'createProductionServer') return 'createProductionServer(';
  const loader = LOADERS.get(node.text);
  if (node.text === 'createRequire' && isValueReference(node))
    return 'createRequire(';
  return loader && isValueReference(node) && isGlobal(checker, node)
    ? loader
    : null;
};

/** `module.require`, `globalThis['require']`, `import.meta.require` or
 * `const { require } = module`: require read off a global or import.meta. */
const requireMember = (
  checker: ts.TypeChecker,
  node: ts.Node,
): string | null => {
  const owner =
    ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
      ? node.expression
      : ts.isBindingElement(node) &&
          ts.isVariableDeclaration(node.parent.parent)
        ? node.parent.parent.initializer
        : undefined;
  if (owner && ts.isMetaProperty(owner)) return 'import.meta.require(';
  return owner && ts.isIdentifier(owner) && isGlobal(checker, owner)
    ? `${owner.text}.require(`
    : null;
};

/** A reference read as a value: not a declared, property or member name
 * (a shorthand `{ require }` is a value), and not inside a type. */
const isValueReference = (node: ts.Identifier) => {
  const parent = node.parent as ts.Node & {
    readonly name?: ts.Node;
    readonly propertyName?: ts.Node;
  };
  const nameSlot =
    (parent.name === node || parent.propertyName === node) &&
    !ts.isShorthandPropertyAssignment(parent);
  return !nameSlot && !inType(node);
};

const inType = (node: ts.Node): boolean => {
  for (let at = node.parent; at && !ts.isStatement(at); at = at.parent)
    if (ts.isTypeNode(at)) return true;
  return false;
};

/** No declaration anywhere in the program: the host's own binding. */
const isGlobal = (checker: ts.TypeChecker, node: ts.Identifier) => {
  const symbol = ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent)
    : checker.getSymbolAtLocation(node);
  return !symbol?.declarations?.length;
};

/** The member a `.name`, `['name']` or `{ name }` destructuring touches. */
const memberName = (node: ts.Node): string | undefined => {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression)
  )
    return node.argumentExpression.text;
  if (!ts.isBindingElement(node) || !ts.isObjectBindingPattern(node.parent))
    return undefined;
  const key = node.propertyName ?? node.name;
  return ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined;
};
