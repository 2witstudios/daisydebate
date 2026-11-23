import ts from 'typescript';

const componentDirectory = 'apps/web/src/ui/components/';
/** The one place a native dialog is shown or closed (the Dialog's lifetime). */
const modalOwner = 'apps/web/src/ui/edge/use-modal.ts';
const dialogMethods = new Set(['showModal', 'show']);
const productionMarkup = /^apps\/web\/src\/.*\.[jt]sx$/;
const testMarkup = /\.test(?:[.-]|$)|\/test-support\//;

const ownerForRole = (role: string) => {
  switch (role) {
    case 'dialog':
      return 'Dialog or DialogRegion';
    case 'alert':
    case 'status':
      return 'Announcement';
    default:
      return undefined;
  }
};

/** Resolve same-file const bindings only. No project or libraries are loaded. */
const checkRolesIn = (file: ts.SourceFile) => {
  let checker: ts.TypeChecker | undefined;
  const constInitializer = (identifier: ts.Identifier) => {
    if (checker === undefined) {
      const options = {
        noLib: true,
        noResolve: true,
        jsx: ts.JsxEmit.Preserve,
      };
      const host = ts.createCompilerHost(options);
      const program = ts.createProgram([file.fileName], options, {
        ...host,
        getSourceFile: (path) => (path === file.fileName ? file : undefined),
      });
      checker = program.getTypeChecker();
    }
    const declaration =
      checker.getSymbolAtLocation(identifier)?.valueDeclaration;
    if (
      declaration !== undefined &&
      declaration.getSourceFile() === file &&
      ts.isVariableDeclaration(declaration) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0
    )
      return declaration.initializer;
    return undefined;
  };

  const roleOwner = (
    value: ts.Node,
    visited: Set<ts.Node>,
  ): string | undefined => {
    if (visited.has(value)) return undefined;
    visited.add(value);
    if (ts.isStringLiteralLike(value)) return ownerForRole(value.text);
    if (ts.isConditionalExpression(value))
      return (
        roleOwner(value.whenTrue, visited) ??
        roleOwner(value.whenFalse, visited)
      );
    if (
      ts.isParenthesizedExpression(value) ||
      ts.isAsExpression(value) ||
      ts.isSatisfiesExpression(value)
    )
      return roleOwner(value.expression, visited);
    if (ts.isJsxExpression(value) && value.expression !== undefined)
      return roleOwner(value.expression, visited);
    if (ts.isIdentifier(value)) {
      const initializer = constInitializer(value);
      if (initializer !== undefined) return roleOwner(initializer, visited);
    }
    return undefined;
  };

  return (value: ts.Node) => roleOwner(value, new Set());
};

const productionSource = /^apps\/web\/src\/.*\.[cm]?[jt]sx?$/;

/**
 * Native JSX outside the primitive directory should use the shared owner;
 * anywhere in the web source, a dialog is opened only by its Dialog and a
 * Button always names a variant that owns its look (RECON-3.8).
 */
export function uiPrimitiveIssues(path: string, source: string): string[] {
  if (!productionSource.test(path) || testMarkup.test(path)) return [];
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const issues: string[] = [];
  const report = (node: ts.Node, message: string) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    issues.push(`${path}:${line + 1}: ${message}`);
  };
  const owned = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      dialogMethods.has(node.expression.name.text) &&
      path !== modalOwner
    )
      report(node, 'open a dialog through Dialog, which owns its lifetime');
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(file) === 'variant' &&
      node.initializer !== undefined &&
      /^\{?\s*["'`]unstyled["'`]\s*\}?$/.test(node.initializer.getText(file))
    )
      report(node, 'give this Button a variant that owns its look');
    ts.forEachChild(node, owned);
  };
  owned(file);
  if (!productionMarkup.test(path) || path.startsWith(componentDirectory))
    return issues;
  const roleOwner = checkRolesIn(file);
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
      if (owner !== undefined) report(node, `use ${owner} for this <${tag}>`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return issues;
}
