/**
 * Host time stays in one module (R4.7). Server code waits through an injected
 * `Waits` (`@daisy/clock`) and runs background work through `@daisy/worker`;
 * `@daisy/worker/host` is the only server module that touches the host's
 * timers. The rule refuses every spelling that reaches one: a timer global
 * read under any name (called, aliased, passed or destructured), a host
 * object (`globalThis`, `global`, `window`, `self`) read as anything but a
 * static, harmless member, `Bun.sleep`, `Bun.sleepSync`,
 * `AbortSignal.timeout`, `Atomics.wait`, the `timers` modules, and `sleep`
 * from `bun`. Browser files are the client edge's (eslint.config-client-edge.mjs).
 */
const timerNames = new Set([
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
]);
const hostObjects = new Set(['globalThis', 'global', 'window', 'self']);
/** Host namespaces and the members of each that wait on time. */
const timedMembers = new Map([
  ['Bun', new Set(['sleep', 'sleepSync'])],
  ['AbortSignal', new Set(['timeout'])],
  ['Atomics', new Set(['wait', 'waitAsync'])],
]);
const timerModules = new Set([
  'timers',
  'node:timers',
  'timers/promises',
  'node:timers/promises',
]);
const bunModules = new Set(['bun']);
const wrappers = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'ChainExpression',
]);

const staticName = (key, computed) => {
  if (key == null) return undefined;
  if (!computed && key.type === 'Identifier') return key.name;
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value;
  if (key.type === 'TemplateLiteral' && key.expressions.length === 0)
    return key.quasis[0].value.cooked;
  return undefined;
};
const moduleName = (node) =>
  node?.type === 'Literal' && typeof node.value === 'string'
    ? node.value
    : node?.type === 'TemplateLiteral' && node.expressions.length === 0
      ? node.quasis[0].value.cooked
      : undefined;

/** The node a value flows into, past type-only wrappers. */
const usage = (node) => {
  let current = node;
  while (current.parent && wrappers.has(current.parent.type))
    current = current.parent;
  return current;
};
/** The static member read off `node`, or `undefined` when it is used otherwise. */
const memberRead = (node) => {
  const used = usage(node);
  const parent = used.parent;
  if (parent?.type !== 'MemberExpression' || parent.object !== used)
    return undefined;
  const name = staticName(parent.property, parent.computed);
  return name === undefined ? undefined : { name, node: parent };
};

const isBrowserFile = (path, ast) =>
  path.includes('/apps/web/src/') &&
  (path.includes('/src/ui/') ||
    /\/[^/]*browser[^/]*\.[cm]?[jt]sx?$/.test(path) ||
    ast.body.some((node) => node.directive === 'use client'));

const hostTime = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      timer:
        '{{name}} is host time. Take `Waits` from @daisy/clock, or run the work through @daisy/worker.',
      host: 'A host object read this way can reach its timers. Read a static member, or inject what you need.',
      module:
        'The {{name}} module is host time. Take `Waits` from @daisy/clock instead.',
    },
  },
  create(context) {
    const { sourceCode } = context;
    const path = context.filename.replaceAll('\\', '/');
    if (isBrowserFile(path, sourceCode.ast)) return {};
    const report = (node, messageId, name) =>
      context.report({ node, messageId, data: { name } });
    /** A host namespace (`Bun`, `AbortSignal`, `Atomics`) reached at `node`. */
    const inspectNamespace = (node, namespace) => {
      const used = usage(node);
      if (
        namespace === 'AbortSignal' &&
        used.parent?.type === 'BinaryExpression' &&
        used.parent.operator === 'instanceof' &&
        used.parent.right === used
      )
        return;
      const read = memberRead(node);
      if (read === undefined) return report(used, 'host', namespace);
      if (timedMembers.get(namespace).has(read.name))
        report(read.node, 'timer', `${namespace}.${read.name}`);
    };
    /** A host object (`globalThis` and its aliases) reached at `node`. */
    const inspectHost = (node, host) => {
      const read = memberRead(node);
      if (read === undefined) return report(usage(node), 'host', host);
      if (timerNames.has(read.name))
        return report(read.node, 'timer', read.name);
      if (hostObjects.has(read.name)) return inspectHost(read.node, read.name);
      if (timedMembers.has(read.name)) inspectNamespace(read.node, read.name);
    };
    const inspectModule = (node, source) => {
      const name = moduleName(source);
      if (name === undefined) {
        if (source != null) report(node, 'module', 'dynamic');
        return;
      }
      if (timerModules.has(name)) report(node, 'module', name);
    };
    const inspectBunImport = (node) => {
      if (!bunModules.has(moduleName(node.source))) return;
      for (const specifier of node.specifiers ?? []) {
        if (specifier.type !== 'ImportSpecifier') {
          if (node.importKind !== 'type')
            report(specifier, 'host', 'bun namespace');
          continue;
        }
        const imported = staticName(specifier.imported, false);
        if (timedMembers.get('Bun').has(imported))
          report(specifier, 'timer', `bun ${imported}`);
      }
    };
    /** Inside a type (`typeof setTimeout`), a name is no use of the host. */
    const inType = (node) => {
      for (let current = node.parent; current; current = current.parent)
        if (current.type === 'TSTypeQuery') return true;
      return false;
    };
    /**
     * Every read of a host global: unresolved names, and names the parser
     * resolves to an implicit library variable (`globalThis`, `Atomics`).
     */
    const globals = () => {
      const scope = sourceCode.scopeManager.globalScope;
      if (scope === null) return [];
      const implicit = scope.variables
        .filter((variable) => variable.defs.length === 0)
        .flatMap((variable) => variable.references);
      return [...scope.through, ...implicit].filter(
        (reference) =>
          reference.isValueReference &&
          !inType(reference.identifier) &&
          (reference.resolved === null || reference.resolved.defs.length === 0),
      );
    };
    return {
      ImportDeclaration(node) {
        inspectModule(node, node.source);
        inspectBunImport(node);
      },
      ExportNamedDeclaration(node) {
        if (node.source) inspectModule(node, node.source);
      },
      ExportAllDeclaration(node) {
        inspectModule(node, node.source);
      },
      ImportExpression(node) {
        inspectModule(node, node.source);
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require')
          inspectModule(node, node.arguments[0] ?? null);
      },
      'Program:exit'() {
        for (const reference of globals()) {
          const { identifier } = reference;
          const name = identifier.name;
          if (timerNames.has(name)) report(identifier, 'timer', name);
          else if (hostObjects.has(name)) inspectHost(identifier, name);
          else if (timedMembers.has(name)) inspectNamespace(identifier, name);
        }
      },
    };
  },
};

export const hostTimeRules = {
  files: [
    'apps/*/src/**/*.{ts,tsx,js,jsx,mjs}',
    'packages/*/src/**/*.{ts,tsx,js,jsx,mjs}',
  ],
  ignores: [
    '**/*.test.*',
    '**/*.test-support.*',
    '**/test-support/**',
    // The one host-time module.
    'packages/worker/src/host.ts',
  ],
  plugins: { 'daisy-time': { rules: { 'host-time': hostTime } } },
  rules: { 'daisy-time/host-time': 'error' },
};
