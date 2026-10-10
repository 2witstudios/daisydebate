import ts from 'typescript';

const parse = (text: string) =>
  ts.createSourceFile(
    'runner.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
function visitMatching(
  source: ts.Node,
  matches: (node: ts.Node) => boolean,
): boolean {
  if (matches(source)) return true;
  let found = false;
  ts.forEachChild(source, (node) => {
    if (!found) found = visitMatching(node, matches);
  });
  return found;
}
function profileBranchClaims(text: string, profile: string, config: string) {
  const source = parse(text);
  return visitMatching(source, (node) => {
    if (
      !ts.isCaseClause(node) ||
      !ts.isStringLiteral(node.expression) ||
      node.expression.text !== profile
    )
      return false;
    return visitMatching(
      node,
      (property) =>
        ts.isPropertyAssignment(property) &&
        property.name.getText(source) === 'config' &&
        ts.isStringLiteral(property.initializer) &&
        property.initializer.text === config,
    );
  });
}
function profileBinding(source: ts.SourceFile, expression: ts.Expression) {
  if (
    !ts.isPropertyAccessExpression(expression) ||
    expression.name.text !== 'config'
  )
    return false;
  const binding = expression.expression.getText(source);
  const imported = visitMatching(
    source,
    (node) =>
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === './realtime-profile' &&
      node.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(node.importClause.namedBindings) &&
      node.importClause.namedBindings.elements.some(
        (entry) =>
          entry.name.text === 'realtimeProofProfile' &&
          entry.propertyName === undefined,
      ),
  );
  if (!imported) return false;
  return visitMatching(
    source,
    (node) =>
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === binding &&
      node.initializer !== undefined &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(source) === 'realtimeProofProfile' &&
      node.initializer.arguments[0]?.getText(source) === 'Bun.argv[2]',
  );
}
/** Claims actual literal configs, or the explicitly bound closed RT profile producer. */
export function browserRunnerClaimsConfig(
  text: string,
  config: string,
  profile?: string,
  profileSource?: string,
) {
  const source = parse(text);
  return visitMatching(source, (node) => {
    if (
      !ts.isCallExpression(node) ||
      node.expression.getText(source) !== 'Bun.spawn'
    )
      return false;
    const args = node.arguments[0];
    if (!args || !ts.isArrayLiteralExpression(args)) return false;
    const literals = args.elements
      .filter(ts.isStringLiteral)
      .map((value) => value.text);
    if (
      !literals.includes('../../scripts/e2e-limit.ts') ||
      !literals.includes('--config')
    )
      return false;
    const index = args.elements.findIndex(
      (value) => ts.isStringLiteral(value) && value.text === '--config',
    );
    const selected = args.elements[index + 1];
    if (!selected) return false;
    if (ts.isStringLiteral(selected) && selected.text === config) return true;
    return Boolean(
      profile &&
      profileSource &&
      ts.isExpression(selected) &&
      profileBinding(source, selected) &&
      profileBranchClaims(profileSource, profile!, config),
    );
  });
}
