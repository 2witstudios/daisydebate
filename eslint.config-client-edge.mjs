const effects = new Set(['useEffect', 'useLayoutEffect', 'useInsertionEffect']);
const browserOperations = new Set([
  'fetch',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'requestAnimationFrame',
  'cancelAnimationFrame',
]);
const hosts = new Set(['window', 'globalThis', 'self']);
const memberName = (key, computed) => {
  if (!computed && key.type === 'Identifier') return key.name;
  if (key.type === 'Literal') return key.value;
  if (key.type === 'TemplateLiteral' && key.expressions.length === 0)
    return key.quasis[0].value.cooked;
  return undefined;
};

const browserEdge = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      effect: 'Import a browser lifecycle hook from ui/edge.',
      operation: 'Use the browser operation in ui/edge.',
      server: 'Keep server transport in the server boundary.',
    },
  },
  create(context) {
    const { sourceCode } = context;
    const path = context.filename.replaceAll('\\', '/');
    const globals = sourceCode.scopeManager.globalScope;
    const browser =
      path.includes('/src/ui/') ||
      /\/[^/]*browser[^/]*\.[cm]?[jt]sx?$/.test(path) ||
      sourceCode.ast.body.some((node) => node.directive === 'use client');
    const reactNamespaces = new Set(
      sourceCode.ast.body
        .filter(
          (node) =>
            node.type === 'ImportDeclaration' && node.source.value === 'react',
        )
        .flatMap((node) =>
          node.specifiers
            .filter(
              (specifier) =>
                specifier.type === 'ImportDefaultSpecifier' ||
                specifier.type === 'ImportNamespaceSpecifier',
            )
            .map((specifier) => specifier.local.name),
        ),
    );
    const report = (node, messageId) => context.report({ node, messageId });
    const reactBindings = (node) => {
      if (node.source?.value !== 'react') return;
      for (const specifier of node.specifiers) {
        const binding = specifier.imported ?? specifier.local;
        if (effects.has(memberName(binding, false)))
          report(specifier, 'effect');
      }
    };
    const inspectMember = (node, object, member) => {
      if (reactNamespaces.has(object) && effects.has(member))
        report(node, 'effect');
      if (
        hosts.has(object) &&
        browserOperations.has(member) &&
        (browser || object === 'window')
      )
        report(node, 'operation');
    };
    const inspectPattern = (pattern, source) => {
      if (pattern.type !== 'ObjectPattern' || source?.type !== 'Identifier')
        return;
      for (const property of pattern.properties)
        if (property.type === 'Property')
          inspectMember(
            property,
            source.name,
            memberName(property.key, property.computed),
          );
    };
    return {
      ImportDeclaration(node) {
        if (
          path.includes('/src/server/') &&
          /(?:^|\/)ui\/edge(?:\/|$)/.test(node.source.value)
        )
          report(node, 'server');
        reactBindings(node);
      },
      ExportNamedDeclaration: reactBindings,
      MemberExpression(node) {
        if (node.object.type === 'Identifier')
          inspectMember(
            node,
            node.object.name,
            memberName(node.property, node.computed),
          );
      },
      VariableDeclarator(node) {
        inspectPattern(node.id, node.init);
      },
      AssignmentExpression(node) {
        inspectPattern(node.left, node.right);
      },
      'Program:exit'() {
        if (!browser) return;
        const references = [
          ...globals.through,
          ...globals.variables
            .filter((variable) => variable.defs.length === 0)
            .flatMap((variable) => variable.references),
        ];
        for (const reference of references) {
          if (
            reference.isValueReference &&
            browserOperations.has(reference.identifier.name)
          )
            report(reference.identifier, 'operation');
        }
      },
    };
  },
};

export const clientEdgeRules = {
  files: ['apps/web/src/**/*.{ts,tsx,js,jsx,mjs}'],
  ignores: [
    'apps/web/src/ui/edge/**',
    'apps/web/src/**/*.test.*',
    'apps/web/src/**/*.test-support.*',
    'apps/web/src/**/test-support/**',
  ],
  plugins: { 'daisy-client': { rules: { 'browser-edge': browserEdge } } },
  rules: { 'daisy-client/browser-edge': 'error' },
  settings: {
    'react-hooks': {
      additionalEffectHooks: '^(useBrowserEffect|useBrowserLayoutEffect)$',
    },
  },
};
