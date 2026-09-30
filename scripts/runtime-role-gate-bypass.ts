import ts from 'typescript';

// What start.ts, and every module it loads outside listen-first.ts's own
// imports, must never do itself (scripts/runtime-role-gate.ts): compose,
// prepare or listen by any access form, or load code through a dynamic
// import, the real CommonJS require, eval, Function or any Module loader
// entry point.

/** Module's loader entry points: each loads, resolves, compiles or hooks
 * code (ISSUE-258). In Bun 1.4.2 `_load` returns undefined, but `_compile`
 * runs source and `prototype.require` loads; all are refused regardless. */
const MODULE_LOADERS = [
  '_load',
  '_resolveFilename',
  '_compile',
  '_extensions',
  '_cache',
  '_pathCache',
  '_nodeModulePaths',
  '_findPath',
  '_initPaths',
  '_preloadModules',
  'wrap',
  'runMain',
  'register',
  'registerHooks',
  'getBuiltinModule',
  'Module',
] as const;

/** Loader names unambiguous enough to refuse as any identifier too. */
const UNAMBIGUOUS_LOADERS = new Set<string>(
  MODULE_LOADERS.filter(
    (name) =>
      name.startsWith('_') ||
      name === 'getBuiltinModule' ||
      name === 'registerHooks',
  ),
);

/** Members start.ts must never touch itself, by any access form and off
 * any owner (ISSUE-224, ISSUE-239, ISSUE-240, ISSUE-258). */
const BYPASS_MEMBERS = new Map<string, string>([
  ['listen', '.listen('],
  ['prepare', 'nextApp.prepare('],
  ['getRequestHandler', 'getRequestHandler('],
  ['createRequire', 'createRequire('],
  ['eval', 'eval('],
  ['Function', 'Function('],
  ...MODULE_LOADERS.map((name) => [name, `.${name}(`] as const),
]);

const NODE_MODULE = new Set(['module', 'node:module']);

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
  if (ts.isImportSpecifier(node)) return moduleImportBypass(node);
  if (ts.isIdentifier(node)) return identifierBypass(checker, node);
  const member = memberName(node);
  if (member === 'require') return requireMember(node);
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
  // Any identifier named createRequire, as main refused: an import alias,
  // a namespace member or a destructured key reaches it too (ISSUE-239).
  if (node.text === 'createRequire') return 'createRequire(';
  if (UNAMBIGUOUS_LOADERS.has(node.text)) return `.${node.text}(`;
  return loader && isValueReference(node) && isGlobal(checker, node)
    ? loader
    : null;
};

/** A Module loader imported by name from `module` or `node:module`,
 * aliased or not (ISSUE-258). */
const moduleImportBypass = (node: ts.ImportSpecifier): string | null => {
  const name = (node.propertyName ?? node.name).text;
  const declaration = node.parent.parent.parent;
  return (MODULE_LOADERS as readonly string[]).includes(name) &&
    ts.isStringLiteral(declaration.moduleSpecifier) &&
    NODE_MODULE.has(declaration.moduleSpecifier.text)
    ? `.${name}(`
    : null;
};

/** Any read of a `require` member: `module.require`, `g.require` for any
 * owner, `globalThis['require']`, `import.meta.require` or
 * `const { require } = module`, as main refused (ISSUE-235). */
const requireMember = (node: ts.Node): string => {
  const owner =
    ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
      ? node.expression
      : ts.isBindingElement(node) &&
          ts.isVariableDeclaration(node.parent.parent)
        ? node.parent.parent.initializer
        : undefined;
  if (owner && ts.isMetaProperty(owner)) return 'import.meta.require(';
  return owner && ts.isIdentifier(owner)
    ? `${owner.text}.require(`
    : '.require(';
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

/** No non-ambient declaration anywhere in the program: the host's own
 * binding. */
const isGlobal = (checker: ts.TypeChecker, node: ts.Identifier) => {
  const symbol = ts.isShorthandPropertyAssignment(node.parent)
    ? checker.getShorthandAssignmentValueSymbol(node.parent)
    : checker.getSymbolAtLocation(node);
  return (symbol?.declarations ?? []).every(isAmbient);
};

/** A `declare`d or `declare global` binding only describes the host's
 * own one, so it never makes require or module local (ISSUE-235). */
const isAmbient = (declaration: ts.Declaration) =>
  (declaration.flags & ts.NodeFlags.Ambient) !== 0 ||
  declaration.getSourceFile().isDeclarationFile;

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
