const dateMessage = 'Read an ISO instant through @daisy/clock.';
const digestMessage = 'Use sha3Hex or commandDigest from @daisy/digest.';

function bindingAt(node, sourceCode) {
  if (node?.type !== 'Identifier') return;
  for (let scope = sourceCode.getScope(node); scope; scope = scope.upper) {
    const binding = scope.set.get(node.name);
    if (binding) return binding;
  }
}

function constant(node, sourceCode, seen) {
  const binding = bindingAt(node, sourceCode);
  const [definition] = binding?.defs ?? [];
  if (
    binding?.defs.length === 1 &&
    !seen.has(binding) &&
    definition?.type === 'Variable' &&
    definition.parent.kind === 'const' &&
    definition.node.id.type === 'Identifier'
  ) {
    seen.add(binding);
    return definition.node.init;
  }
}

function isGlobal(node, name, sourceCode) {
  return (
    node?.type === 'Identifier' &&
    node.name === name &&
    !bindingAt(node, sourceCode)?.defs.length
  );
}

function staticText(node, sourceCode, seen = new Set()) {
  if (node?.type === 'Literal') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked;
  if (sourceCode && node?.type === 'Identifier')
    return staticText(constant(node, sourceCode, seen), sourceCode, seen);
}

const property = (node, sourceCode) =>
  node.type === 'MemberExpression'
    ? node.computed
      ? staticText(node.property, sourceCode)
      : node.property.name
    : undefined;

function isDate(node, sourceCode, seen = new Set()) {
  if (!node) return false;
  if (node.type === 'Identifier') {
    if (isGlobal(node, 'Date', sourceCode)) return true;
    return isDate(constant(node, sourceCode, seen), sourceCode, seen);
  }
  return (
    property(node, sourceCode) === 'Date' &&
    ['globalThis', 'window', 'self', 'global'].some((name) =>
      isGlobal(node.object, name, sourceCode),
    )
  );
}

const dateRule = {
  meta: { messages: { required: dateMessage } },
  create(context) {
    const report = (node) => context.report({ node, messageId: 'required' });
    const readsParse = (pattern) =>
      pattern.type === 'ObjectPattern' &&
      pattern.properties.some(
        ({ key, computed }) =>
          (computed
            ? staticText(key, context.sourceCode)
            : (key?.name ?? staticText(key))) === 'parse',
      );
    return {
      MemberExpression(node) {
        if (
          property(node, context.sourceCode) === 'parse' &&
          isDate(node.object, context.sourceCode)
        )
          report(node);
      },
      VariableDeclarator(node) {
        if (readsParse(node.id) && isDate(node.init, context.sourceCode))
          report(node);
      },
      AssignmentExpression(node) {
        if (
          node.operator === '=' &&
          readsParse(node.left) &&
          isDate(node.right, context.sourceCode)
        )
          report(node);
      },
    };
  },
};

function nativeHashName(source, name) {
  return (
    (source === 'bun' && name === 'CryptoHasher') ||
    (['node:crypto', 'crypto'].includes(source) && name === 'createHash')
  );
}

function nativeModule(node, sourceCode, seen) {
  if (isGlobal(node, 'Bun', sourceCode)) return 'bun';
  if (
    node?.type === 'CallExpression' &&
    isGlobal(node.callee, 'require', sourceCode) &&
    node.arguments.length === 1
  )
    return staticText(node.arguments[0], sourceCode);
  const [definition] = bindingAt(node, sourceCode)?.defs ?? [];
  if (
    ['ImportNamespaceSpecifier', 'ImportDefaultSpecifier'].includes(
      definition?.node.type,
    )
  )
    return definition.node.parent.source.value;
  const initializer = constant(node, sourceCode, seen);
  if (initializer) return nativeModule(initializer, sourceCode, seen);
}

function isNativeHasher(node, sourceCode, seen = new Set()) {
  if (!node) return false;
  if (node.type === 'Identifier') {
    const [definition] = bindingAt(node, sourceCode)?.defs ?? [];
    if (definition?.node.type === 'ImportSpecifier')
      return nativeHashName(
        definition.node.parent.source.value,
        definition.node.imported.name ?? definition.node.imported.value,
      );
    if (
      definition?.type === 'Variable' &&
      definition.parent.kind === 'const' &&
      definition.node.id.type === 'ObjectPattern'
    ) {
      const member = definition.node.id.properties.find(
        ({ value }) =>
          (value?.type === 'AssignmentPattern' ? value.left : value) ===
          definition.name,
      );
      if (member)
        return nativeHashName(
          nativeModule(definition.node.init, sourceCode, seen),
          member.computed
            ? staticText(member.key, sourceCode)
            : (member.key.name ?? staticText(member.key)),
        );
    }
    return isNativeHasher(constant(node, sourceCode, seen), sourceCode, seen);
  }
  return (
    node.type === 'MemberExpression' &&
    nativeHashName(
      nativeModule(node.object, sourceCode, seen),
      property(node, sourceCode),
    )
  );
}

const hashRule = {
  meta: { messages: { required: digestMessage } },
  create(context) {
    const report = (node) => context.report({ node, messageId: 'required' });
    const check = (node) => {
      const algorithm = staticText(node.arguments[0], context.sourceCode);
      if (
        typeof algorithm === 'string' &&
        algorithm.toLowerCase() === 'sha3-256' &&
        isNativeHasher(node.callee, context.sourceCode)
      )
        report(node);
    };
    return {
      Program(node) {
        for (const statement of node.body) {
          if (statement.type !== 'ImportDeclaration') continue;
          const source = statement.source.value;
          if (
            (source === '@noble/hashes/sha3.js' ||
              source === '@noble/hashes/sha3') &&
            statement.specifiers.some(
              (specifier) =>
                specifier.type !== 'ImportSpecifier' ||
                (specifier.imported.name ?? specifier.imported.value) ===
                  'sha3_256',
            )
          )
            report(statement);
        }
      },
      CallExpression: check,
      NewExpression: check,
    };
  },
};

const plugin = {
  rules: { 'iso-instant': dateRule, 'sha3-digest': hashRule },
};

const files = ['**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}'];

export const clockDigestRules = [
  {
    files,
    ignores: ['packages/clock/**'],
    plugins: { 'clock-digest': plugin },
    rules: { 'clock-digest/iso-instant': 'error' },
  },
  {
    files,
    ignores: ['packages/digest/**'],
    plugins: { 'clock-digest': plugin },
    rules: { 'clock-digest/sha3-digest': 'error' },
  },
];
