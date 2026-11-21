import ts from 'typescript';

const componentDirectory = 'apps/web/src/ui/components/';
const productionMarkup = /^apps\/web\/src\/.*\.[jt]sx$/;
const testMarkup = /\.test(?:[.-]|$)|\/test-support\//;

const ownerForRole = (role: string) => {
  switch (role) {
    case 'dialog':
      return 'Dialog';
    case 'alert':
    case 'status':
      return 'StatusRegion';
    default:
      return undefined;
  }
};

const roleOwner = (value: ts.Node): string | undefined => {
  if (ts.isStringLiteralLike(value)) return ownerForRole(value.text);
  if (ts.isConditionalExpression(value))
    return roleOwner(value.whenTrue) ?? roleOwner(value.whenFalse);
  if (ts.isJsxExpression(value) && value.expression !== undefined)
    return roleOwner(value.expression);
  return undefined;
};

/** Native JSX outside the primitive directory should use the shared owner. */
export function uiPrimitiveIssues(path: string, source: string): string[] {
  if (
    !productionMarkup.test(path) ||
    testMarkup.test(path) ||
    path.startsWith(componentDirectory)
  )
    return [];
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const issues: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      /^[a-z]/.test(node.tagName.text)
    ) {
      const tag = node.tagName.text;
      const role = node.attributes.properties.find(
        (prop): prop is ts.JsxAttribute =>
          ts.isJsxAttribute(prop) && prop.name.getText(file) === 'role',
      );
      const owner =
        tag === 'button'
          ? 'Button'
          : tag === 'dialog'
            ? 'Dialog'
            : role?.initializer === undefined
              ? undefined
              : roleOwner(role.initializer);
      if (owner !== undefined) {
        const { line } = file.getLineAndCharacterOfPosition(
          node.getStart(file),
        );
        issues.push(`${path}:${line + 1}: use ${owner} for this <${tag}>`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return issues;
}
