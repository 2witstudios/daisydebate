// Markup rules of ADR 0114: Daisy requires JavaScript. Nothing is built or
// tested for JavaScript being off, so a `<noscript>` fallback, a meta
// refresh or a browser context with scripts off never returns. The one rule
// the decision keeps is that a form used before hydration never submits as a
// native GET, which would put what was typed in the URL: every form names
// where it submits (a React action, a URL with its method, or its dialog),
// and only the search primitives submit by GET.

import ts from 'typescript';

/** The only modules that render a GET form: a search or filter changes a query, never data. */
export const searchPrimitives: readonly string[] = [
  'apps/web/src/ui/components/search-form/search-form.tsx',
  'apps/admin/src/app/search-form.tsx',
];

const scanned = /\.[cm]?[jt]sx?$/;

const attributeName = (attribute: ts.JsxAttributeLike): string | undefined =>
  ts.isJsxAttribute(attribute) ? attribute.name.getText() : undefined;

const propertyName = (name: ts.PropertyName): string | undefined => {
  const key = ts.isComputedPropertyName(name) ? name.expression : name;
  if (ts.isStringLiteralLike(key)) return key.text;
  return ts.isIdentifier(name) ? name.text : undefined;
};

/** A literal attribute value (`"post"`, `{'post'}`, `{`post`}`), lower-cased; undefined otherwise. */
const literalValue = (
  attribute: ts.JsxAttribute | undefined,
): string | undefined => {
  const value = attribute?.initializer;
  if (value === undefined) return undefined;
  if (ts.isStringLiteral(value)) return value.text.toLowerCase();
  const expression = ts.isJsxExpression(value) ? value.expression : undefined;
  return expression !== undefined &&
    (ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression))
    ? expression.text.toLowerCase()
    : undefined;
};

/** An `action` written as a URL: a string or a template, which React submits natively. */
const isAddress = (attribute: ts.JsxAttribute): boolean => {
  const value = attribute.initializer;
  if (value === undefined) return false;
  if (ts.isStringLiteral(value)) return true;
  const expression = ts.isJsxExpression(value) ? value.expression : undefined;
  return (
    expression !== undefined &&
    (ts.isStringLiteral(expression) ||
      ts.isTemplateExpression(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression))
  );
};

const formIssues = (
  element: ts.JsxOpeningLikeElement,
  primitive: boolean,
): readonly string[] => {
  const attributes = element.attributes.properties;
  const named = (name: string) =>
    attributes.find(
      (attribute): attribute is ts.JsxAttribute =>
        attributeName(attribute) === name,
    );
  const action = named('action');
  const methodAttribute = named('method');
  const method = literalValue(methodAttribute);
  if (method === 'dialog') return [];
  if (action === undefined)
    return [
      'a form with no action attribute submits as a native GET to this page before hydration; pass `action` explicitly (a spread does not count) (ADR 0114)',
    ];
  if (method === 'get' && !primitive)
    return [
      'a GET form outside the search primitives; use SearchForm, or POST (ADR 0114)',
    ];
  if (isAddress(action) && methodAttribute === undefined)
    return [
      'a form posting to a URL with no method submits as a native GET; add method="post" (ADR 0114)',
    ];
  return [];
};

const scriptOff = {
  noscript:
    'a <noscript> fallback; Daisy requires JavaScript, so nothing renders for it being off (ADR 0114)',
  refresh:
    'a meta refresh; Daisy requires JavaScript, so a page that waits polls or subscribes from script (ADR 0114)',
  context:
    'a browser context with JavaScript off; nothing is tested for JavaScript being off (ADR 0114)',
} as const;

/** Every ADR 0114 finding in one source file, as `path:line: reason`. */
export const javascriptRequiredIssues = (
  path: string,
  source: string,
): readonly string[] => {
  if (!scanned.test(path)) return [];
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const primitive = searchPrimitives.includes(path);
  const issues: string[] = [];
  const report = (node: ts.Node, reason: string) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    issues.push(`${path}:${line + 1}: ${reason}`);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(file);
      if (tag === 'form')
        for (const reason of formIssues(node, primitive)) report(node, reason);
      if (tag === 'noscript') report(node, scriptOff.noscript);
      const httpEquiv = node.attributes.properties.find(
        (attribute): attribute is ts.JsxAttribute =>
          attributeName(attribute)?.toLowerCase().replace('-', '') ===
          'httpequiv',
      );
      if (httpEquiv !== undefined && literalValue(httpEquiv) === 'refresh')
        report(node, scriptOff.refresh);
    }
    if (
      (ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node)) &&
      propertyName(node.name) === 'javaScriptEnabled'
    )
      report(node, scriptOff.context);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return issues;
};
