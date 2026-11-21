const dateMessage = 'Read an ISO instant through @daisy/clock.';
const digestMessage = 'Use sha3Hex or commandDigest from @daisy/digest.';

const property = (node) =>
  node.type === 'MemberExpression'
    ? node.computed
      ? node.property.value
      : node.property.name
    : undefined;

const isDate = (node) =>
  (node.type === 'Identifier' && node.name === 'Date') ||
  (property(node) === 'Date' &&
    ['globalThis', 'window', 'self', 'global'].includes(node.object.name));

const dateRule = {
  meta: { messages: { required: dateMessage } },
  create(context) {
    const report = (node) => context.report({ node, messageId: 'required' });
    return {
      MemberExpression(node) {
        if (property(node) === 'parse' && isDate(node.object)) report(node);
      },
      VariableDeclarator(node) {
        if (
          node.init &&
          isDate(node.init) &&
          node.id.type === 'ObjectPattern' &&
          node.id.properties.some(
            ({ key }) => key?.name === 'parse' || key?.value === 'parse',
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
      const algorithm = node.arguments[0]?.value;
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
            source === '@noble/hashes/sha3.js' ||
            source === '@noble/hashes/sha3'
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
