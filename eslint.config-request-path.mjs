/**
 * A route's ids come from its typed Next.js params, never from its URL by
 * position (RECON-3.4). This refuses splitting or pattern-matching a
 * request path anywhere in the participant app: `request.url`, a URL's
 * `pathname`, and any const or destructured binding of either. Testing a
 * path's shape (`test`) reads nothing out of it and stays legal, as does
 * `URLPattern`, whose `exec` is named route params.
 */
const message =
  'Take the id from the route params (processRoute.withParams) or pass the bound value; never split or match a request path.';

const pathKeys = new Set(['pathname', 'url']);
const textMethods = new Set(['split', 'match', 'matchAll']);
const patternMethods = new Set(['exec']);

function keyOf(node) {
  if (node.type !== 'MemberExpression') return undefined;
  const { property } = node;
  if (!node.computed) return property.name;
  if (property.type === 'Literal') return property.value;
  return property.type === 'TemplateLiteral' &&
    property.expressions.length === 0
    ? property.quasis[0].value.cooked
    : undefined;
}

function bindingAt(node, sourceCode) {
  for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
    const variable = scope.set.get(node.name);
    if (variable) return variable;
  }
}

/** Whether `node` is a request path: `x.pathname`, `x.url`, or a binding of one. */
function isRequestPath(node, sourceCode, seen = new Set()) {
  if (!node) return false;
  if (node.type === 'ChainExpression')
    return isRequestPath(node.expression, sourceCode, seen);
  if (node.type === 'MemberExpression') return pathKeys.has(keyOf(node));
  if (node.type !== 'Identifier') return false;
  const variable = bindingAt(node, sourceCode);
  if (!variable || seen.has(variable)) return pathKeys.has(node.name);
  seen.add(variable);
  const [definition] = variable.defs;
  if (definition?.type === 'Parameter') return pathKeys.has(node.name);
  if (definition?.type !== 'Variable') return false;
  const declarator = definition.node;
  if (declarator.id.type === 'Identifier')
    return isRequestPath(declarator.init, sourceCode, seen);
  if (declarator.id.type === 'ObjectPattern')
    return declarator.id.properties.some(
      (entry) =>
        entry.type === 'Property' &&
        (entry.value.type === 'AssignmentPattern'
          ? entry.value.left
          : entry.value) === definition.name &&
        pathKeys.has(
          entry.computed
            ? entry.key.value
            : (entry.key.name ?? entry.key.value),
        ),
    );
  return false;
}

/** A `URLPattern`, directly or through a const. */
function isUrlPattern(node, sourceCode) {
  if (node?.type === 'NewExpression')
    return (
      node.callee.type === 'Identifier' && node.callee.name === 'URLPattern'
    );
  if (node?.type !== 'Identifier') return false;
  const [definition] = bindingAt(node, sourceCode)?.defs ?? [];
  return (
    definition?.type === 'Variable' &&
    definition.node.id.type === 'Identifier' &&
    isUrlPattern(definition.node.init, sourceCode)
  );
}

const rule = {
  meta: { type: 'problem', schema: [], messages: { split: message } },
  create(context) {
    const { sourceCode } = context;
    return {
      CallExpression(node) {
        const callee =
          node.callee.type === 'ChainExpression'
            ? node.callee.expression
            : node.callee;
        if (callee.type !== 'MemberExpression') return;
        const method = keyOf(callee);
        if (
          (textMethods.has(method) &&
            isRequestPath(callee.object, sourceCode)) ||
          (patternMethods.has(method) &&
            !isUrlPattern(callee.object, sourceCode) &&
            isRequestPath(node.arguments[0], sourceCode))
        )
          context.report({ node, messageId: 'split' });
      },
    };
  },
};

export const requestPathRules = {
  files: ['apps/web/src/**/*.{ts,tsx}'],
  plugins: { 'request-path': { rules: { 'by-params': rule } } },
  rules: { 'request-path/by-params': 'error' },
};
