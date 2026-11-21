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
  if (key == null) return undefined;
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
    const browser =
      path.includes('/src/ui/') ||
      /\/[^/]*browser[^/]*\.[cm]?[jt]sx?$/.test(path) ||
      sourceCode.ast.body.some((node) => node.directive === 'use client');
    const references = new Map(
      sourceCode.scopeManager.scopes.flatMap((scope) =>
        scope.references.map((reference) => [reference.identifier, reference]),
      ),
    );
    const isHost = (reference) =>
      reference?.isValueReference &&
      (reference.resolved === null || reference.resolved.defs.length === 0);
    const isReactNamespace = (reference) =>
      reference?.resolved?.defs.some(
        (definition) =>
          definition.type === 'ImportBinding' &&
          definition.parent.source.value === 'react' &&
          (definition.node.type === 'ImportDefaultSpecifier' ||
            definition.node.type === 'ImportNamespaceSpecifier'),
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
      if (object.type !== 'Identifier') return;
      const reference = references.get(object);
      if (effects.has(member) && isReactNamespace(reference))
        report(node, 'effect');
      if (
        browserOperations.has(member) &&
        hosts.has(object.name) &&
        (browser || object.name === 'window') &&
        isHost(reference)
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
            source,
            memberName(property.key, property.computed),
          );
    };
    const inspectModule = (node) => {
      if (
        path.includes('/src/server/') &&
        /(?:^|\/)ui\/edge(?:\/|$)/.test(memberName(node.source, true))
      )
        report(node, 'server');
    };
    const staticModule = (node) => {
      inspectModule(node);
      reactBindings(node);
    };
    return {
      ImportDeclaration: staticModule,
      ExportNamedDeclaration: staticModule,
      ExportAllDeclaration: inspectModule,
      ImportExpression: inspectModule,
      MemberExpression(node) {
        inspectMember(
          node,
          node.object,
          memberName(node.property, node.computed),
        );
      },
      VariableDeclarator(node) {
        inspectPattern(node.id, node.init);
      },
      AssignmentExpression(node) {
        inspectPattern(node.left, node.right);
      },
      AssignmentPattern(node) {
        inspectPattern(node.left, node.right);
      },
      'Program:exit'() {
        if (!browser) return;
        for (const [identifier, reference] of references)
          if (browserOperations.has(identifier.name) && isHost(reference))
            report(identifier, 'operation');
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
