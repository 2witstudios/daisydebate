const effects = new Set(['useEffect', 'useLayoutEffect', 'useInsertionEffect']);
/** React's types for an arbitrary effect: a hook taking one is the alias again. */
const effectTypes = new Set(['EffectCallback', 'DependencyList']);
/** The edge's ports: injected into the code that waits or requests, never called outside it. */
const portModule =
  /(?:^|\/)edge\/browser-(?:time|request|waits)(?:\.[cm]?[jt]sx?)?$/;
/** Edge hooks that hand a value to a job: the job must act on that value. */
const valueHooks = new Set([
  'useAnswer',
  'useDeliver',
  'useDeliverBeforePaint',
  'useResource',
]);
const edgeHookModule = /(?:^|\/)edge\/use-[\w-]+(?:\.[cm]?[jt]sx?)?$/;
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
        "A hook taking an arbitrary effect is the effect again; take the job's own inputs.",
      port: 'Inject the ui/edge port into the code that waits or requests; pass it as an argument or property, never call, alias, destructure or default it here.',
      dependencyKey:
        'A key spelled from several values is a dependency list: hand the hook the value its job acts on.',
      triggerField:
        'A field the job never reads ({{fields}}) only re-fires it: hand the hook the value its job acts on.',
      ignoredValue:
        'The job must act on the value the hook hands it; a handler that ignores it is an effect with dependencies.',
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
    /** A port reference is legal only where it is handed on, never used. */
    const passed = (identifier) => {
      let node = identifier;
      while (
        node.parent?.type === 'MemberExpression' &&
        node.parent.object === node
      )
        node = node.parent;
      const parent = node.parent;
      if (!parent) return false;
      if (
        (parent.type === 'CallExpression' || parent.type === 'NewExpression') &&
        parent.arguments.includes(node)
      )
        return true;
      if (
        (parent.type === 'Property' &&
          parent.value === node &&
          parent.parent?.type === 'ObjectExpression') ||
        (parent.type === 'ArrayExpression' && parent.elements.includes(node))
      )
        return handedOn(parent.type === 'Property' ? parent.parent : parent);
      return parent.type === 'JSXExpressionContainer';
    };
    /**
     * An object or array holding a port is handed on only when the literal
     * itself is an argument or a JSX value: bound to a local, the module
     * could call the port through it.
     */
    const handedOn = (literal) => {
      let node = literal;
      for (;;) {
        const parent = node.parent;
        if (
          parent?.type === 'Property' &&
          parent.value === node &&
          parent.parent?.type === 'ObjectExpression'
        ) {
          node = parent.parent;
          continue;
        }
        if (parent?.type === 'ArrayExpression') {
          node = parent;
          continue;
        }
        return (
          ((parent?.type === 'CallExpression' ||
            parent?.type === 'NewExpression') &&
            parent.arguments.includes(node)) ||
          parent?.type === 'JSXExpressionContainer'
        );
      }
    };
    /** Local names bound to a value-handing edge hook. */
    const hookLocals = new Map();
    const hookBindings = (node) => {
      if (inEdge || node.type !== 'ImportDeclaration') return;
      if (!edgeHookModule.test(memberName(node.source, true) ?? '')) return;
      for (const specifier of node.specifiers) {
        const name = memberName(specifier.imported, false);
        if (valueHooks.has(name)) hookLocals.set(specifier.local.name, name);
      }
    };
    const spelledKey = (node) => {
      if (node.type === 'ConditionalExpression')
        return spelledKey(node.consequent) || spelledKey(node.alternate);
      if (node.type === 'LogicalExpression')
        return spelledKey(node.left) || spelledKey(node.right);
      return (
        (node.type === 'TemplateLiteral' && node.expressions.length > 0) ||
        node.type === 'ArrayExpression' ||
        (node.type === 'CallExpression' &&
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'JSON' &&
          memberName(node.callee.property, node.callee.computed) ===
            'stringify')
      );
    };
    const ignoresValue = (handler) => {
      if (
        handler?.type !== 'ArrowFunctionExpression' &&
        handler?.type !== 'FunctionExpression'
      )
        return false;
      const [first] = handler.params;
      if (first === undefined) return true;
      if (first.type !== 'Identifier') return false;
      const variable = sourceCode
        .getDeclaredVariables(handler)
        .find((candidate) => candidate.name === first.name);
      return variable !== undefined && variable.references.length === 0;
    };
    /** The object literal a same-scope `useMemo(() => ({ … }))` binding holds. */
    const memoisedObject = (node) => {
      if (node?.type !== 'Identifier') return null;
      let scope = sourceCode.getScope(node);
      let variable = null;
      while (scope && variable === null) {
        variable = scope.set.get(node.name) ?? null;
        scope = scope.upper;
      }
      const init = variable?.defs[0]?.node?.init;
      if (
        init?.type !== 'CallExpression' ||
        init.callee.type !== 'Identifier' ||
        init.callee.name !== 'useMemo'
      )
        return null;
      const factory = init.arguments[0];
      if (factory?.type !== 'ArrowFunctionExpression') return null;
      return factory.body.type === 'ObjectExpression' ? factory.body : null;
    };
    /** The fields of a memoised value that the handler never reads. */
    const unreadFields = (object, handler) => {
      if (
        handler?.type !== 'ArrowFunctionExpression' &&
        handler?.type !== 'FunctionExpression'
      )
        return [];
      const fields = [];
      for (const property of object.properties) {
        if (property.type !== 'Property') return [];
        const name = memberName(property.key, property.computed);
        if (name === undefined) return [];
        fields.push(name);
      }
      const [first] = handler.params;
      if (first === undefined) return fields;
      let read;
      if (first.type === 'ObjectPattern') {
        if (first.properties.some((p) => p.type === 'RestElement')) return [];
        read = new Set(
          first.properties.map((p) => memberName(p.key, p.computed)),
        );
      } else if (first.type === 'Identifier') {
        const variable = sourceCode
          .getDeclaredVariables(handler)
          .find((candidate) => candidate.name === first.name);
        read = new Set();
        for (const reference of variable?.references ?? []) {
          const parent = reference.identifier.parent;
          if (
            parent?.type === 'MemberExpression' &&
            parent.object === reference.identifier
          )
            read.add(memberName(parent.property, parent.computed));
          else return [];
        }
      } else return [];
      return fields.filter((field) => !read.has(field));
    };
    const inspectHookCall = (node) => {
      if (
        node.callee.type !== 'Identifier' ||
        !hookLocals.has(node.callee.name)
      )
        return;
      const [value, handler] = node.arguments;
      if (value !== undefined && spelledKey(value))
        report(value, 'dependencyKey');
      // An answer's arrival is itself the news; every other hook hands its
      // job the value to act on.
      const object = memoisedObject(value);
      if (object !== null) {
        const unread = unreadFields(object, handler);
        if (unread.length > 0)
          context.report({
            node: value,
            messageId: 'triggerField',
            data: { fields: unread.join(', ') },
          });
      } else if (
        hookLocals.get(node.callee.name) !== 'useAnswer' &&
        ignoresValue(handler)
      )
        report(handler, 'ignoredValue');
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
      hookBindings(node);
      exportedEffects(node);
    };
    return {
      ImportDeclaration: staticModule,
      ExportNamedDeclaration: staticModule,
      ExportAllDeclaration(node) {
        inspectModule(node);
        if (node.source.value === 'react') report(node, 'reexport');
      },
      CallExpression: inspectHookCall,
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
        for (const [identifier, reference] of references)
          if (
            portLocals.has(identifier.name) &&
            reference.resolved?.defs.some((d) => d.type === 'ImportBinding') &&
            !passed(identifier)
          )
            report(identifier, 'port');
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
