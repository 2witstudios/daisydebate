const dateMessage = 'Read an ISO instant through @daisy/clock.';
const digestMessage = 'Use sha3Hex or commandDigest from @daisy/digest.';

function constant(node, sourceCode, seen) {
  if (node?.type !== 'Identifier') return;
  let scope = sourceCode.getScope(node);
  while (scope) {
    const binding = scope.set.get(node.name);
    if (binding) {
      const [definition] = binding.defs;
      if (
        binding.defs.length === 1 &&
        !seen.has(binding) &&
        definition?.type === 'Variable' &&
        definition.parent.kind === 'const' &&
        definition.node.id.type === 'Identifier'
      ) {
        seen.add(binding);
        return definition.node.init;
      }
      return;
    }
    scope = scope.upper;
  }
}

function staticText(node, sourceCode, seen = new Set()) {
  if (node?.type === 'Literal') return node.value;
  if (node?.type === 'TemplateLiteral' && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked;
  if (sourceCode && node?.type === 'Identifier')
    return staticText(constant(node, sourceCode, seen), sourceCode, seen);
}

const property = (node) =>
  node.type === 'MemberExpression'
    ? node.computed
      ? staticText(node.property)
      : node.property.name
    : undefined;

function isDate(node, sourceCode, seen = new Set()) {
  if (!node) return false;
  if (node.type === 'Identifier') {
    if (node.name === 'Date') return true;
    return isDate(constant(node, sourceCode, seen), sourceCode, seen);
  }
  return (
    property(node) === 'Date' &&
    ['globalThis', 'window', 'self', 'global'].includes(node.object.name)
  );
}

const dateRule = {
  meta: { messages: { required: dateMessage } },
  create(context) {
    const report = (node) => context.report({ node, messageId: 'required' });
    return {
      MemberExpression(node) {
        if (
          property(node) === 'parse' &&
          isDate(node.object, context.sourceCode)
        )
          report(node);
      },
      VariableDeclarator(node) {
        if (
          node.init &&
          isDate(node.init, context.sourceCode) &&
          node.id.type === 'ObjectPattern' &&
          node.id.properties.some(
            ({ key }) => key?.name === 'parse' || staticText(key) === 'parse',
          )
        )
          report(node);
      },
    };
  },
};

const hashRule = {
  meta: { messages: { required: digestMessage } },
  create(context) {
    const names = new Set(['createHash', 'CryptoHasher']);
    const report = (node) => context.report({ node, messageId: 'required' });
    const check = (node) => {
      const algorithm = staticText(node.arguments[0], context.sourceCode);
      if (
        typeof algorithm === 'string' &&
        algorithm.toLowerCase() === 'sha3-256' &&
        names.has(node.callee.name ?? property(node.callee))
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
          if (!['crypto', 'node:crypto', 'bun'].includes(source)) continue;
          for (const specifier of statement.specifiers) {
            const imported =
              specifier.imported?.name ?? specifier.imported?.value;
            if (names.has(imported)) names.add(specifier.local.name);
          }
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
