const effects = new Set(['useEffect', 'useLayoutEffect', 'useInsertionEffect']);
/** React's types for an arbitrary effect: a hook taking one is the alias again. */
const effectTypes = new Set(['EffectCallback', 'DependencyList']);
/** The edge's ports: injected into the code that waits or requests, never called outside it. */
const portModule = /(?:^|\/)edge\/browser-(?:time|request)(?:\.[cm]?[jt]sx?)?$/;
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
      effect:
        'Use the ui/edge hook that does this job; React effects stay in ui/edge under every name.',
      reexport:
        'Do not re-export a React effect: it is the effect again under another name.',
      effectType:
        'A hook taking an arbitrary effect is the effect again; take the job\'s own inputs.',
      port: 'Inject the ui/edge port into the code that waits or requests; do not call it here.',
      operation: 'Use the browser operation in ui/edge.',
      server: 'Keep server transport in the server boundary.',
    },
  },
  create(context) {
    const { sourceCode } = context;
    const path = context.filename.replaceAll('\\', '/');
    const inEdge = /\/src\/ui\/edge\//.test(path);
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
    /** Local names bound to a React effect in this module, by import. */
    const effectLocals = new Set();
    const reactBindings = (node) => {
      if (node.source?.value !== 'react') return;
      const exporting = node.type === 'ExportNamedDeclaration';
      for (const specifier of node.specifiers) {
        const binding =
          specifier.type === 'ExportSpecifier'
            ? specifier.local
            : (specifier.imported ?? specifier.local);
        const name = memberName(binding, false);
        if (effectTypes.has(name)) report(specifier, 'effectType');
        if (!effects.has(name)) continue;
        if (exporting) report(specifier, 'reexport');
        else if (!inEdge) report(specifier, 'effect');
        else effectLocals.add(specifier.local.name);
      }
    };
    /** `export { local }` or `export const x = local` of an imported effect. */
    const exportedEffects = (node) => {
      if (node.type !== 'ExportNamedDeclaration' || node.source) return;
      for (const specifier of node.specifiers)
        if (effectLocals.has(memberName(specifier.local, false)))
          report(specifier, 'reexport');
      const declarations =
        node.declaration?.type === 'VariableDeclaration'
          ? node.declaration.declarations
          : [];
      for (const declarator of declarations) {
        const init = declarator.init;
        if (init?.type === 'Identifier' && effectLocals.has(init.name))
          report(declarator, 'reexport');
        if (
          init?.type === 'MemberExpression' &&
          init.object.type === 'Identifier' &&
          isReactNamespace(references.get(init.object)) &&
          effects.has(memberName(init.property, init.computed))
        )
          report(declarator, 'reexport');
      }
    };
    /** Local names bound to an edge port, and namespaces of a port module. */
    const portLocals = new Set();
    const portBindings = (node) => {
      if (inEdge || node.type !== 'ImportDeclaration') return;
      if (!portModule.test(memberName(node.source, true) ?? '')) return;
      for (const specifier of node.specifiers)
        if (specifier.importKind !== 'type' && node.importKind !== 'type')
          portLocals.add(specifier.local.name);
    };
    const portRoot = (callee) => {
      let node = callee;
      while (node.type === 'MemberExpression') node = node.object;
      return node.type === 'Identifier' ? node : null;
    };
    const inspectMember = (node, object, member) => {
      if (object.type !== 'Identifier') return;
      const reference = references.get(object);
      if (effects.has(member) && isReactNamespace(reference) && !inEdge)
        report(node, 'effect');
      if (
        !inEdge &&
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
      portBindings(node);
      exportedEffects(node);
    };
    return {
      ImportDeclaration: staticModule,
      ExportNamedDeclaration: staticModule,
      ExportAllDeclaration(node) {
        inspectModule(node);
        if (node.source.value === 'react') report(node, 'reexport');
      },
      CallExpression(node) {
        const root = portRoot(node.callee);
        if (root === null || !portLocals.has(root.name)) return;
        const reference = references.get(root);
        if (reference?.resolved?.defs.some((d) => d.type === 'ImportBinding'))
          report(node, 'port');
      },
      TSTypeReference(node) {
        const name = node.typeName;
        if (
          name.type === 'TSQualifiedName' &&
          name.left.type === 'Identifier' &&
          effectTypes.has(name.right.name) &&
          isReactNamespace(references.get(name.left))
        )
          report(node, 'effectType');
      },
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
        if (!browser || inEdge) return;
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
    'apps/web/src/**/*.test.*',
    'apps/web/src/**/*.test-support.*',
    'apps/web/src/**/test-support/**',
  ],
  plugins: { 'daisy-client': { rules: { 'browser-edge': browserEdge } } },
  rules: { 'daisy-client/browser-edge': 'error' },
};
