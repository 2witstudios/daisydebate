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
const memberName = (node) =>
  node.computed ? node.property.value : node.property.name;

const browserEdge = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      effect: 'Import a browser lifecycle hook from ui/edge.',
      operation: 'Use the browser operation in ui/edge.',
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
    const reactNamespaces = new Set();
    const report = (node, messageId) => context.report({ node, messageId });
    const reactBindings = (node) => {
      if (node.source?.value !== 'react') return;
      for (const specifier of node.specifiers) {
        const name = specifier.imported?.name ?? specifier.local.name;
        if (effects.has(name)) report(specifier, 'effect');
        if (
          specifier.type === 'ImportDefaultSpecifier' ||
          specifier.type === 'ImportNamespaceSpecifier'
        )
          reactNamespaces.add(specifier.local.name);
      }
    };
    return {
      ImportDeclaration: reactBindings,
      ExportNamedDeclaration: reactBindings,
      'MemberExpression:exit'(node) {
        if (node.object.type !== 'Identifier') return;
        const object = node.object.name;
        const member = memberName(node);
        if (reactNamespaces.has(object) && effects.has(member))
          report(node, 'effect');
        if (
          hosts.has(object) &&
          browserOperations.has(member) &&
          (browser || object === 'window')
        )
          report(node, 'operation');
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
