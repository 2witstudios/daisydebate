const dateMessage = 'Read an ISO instant through @daisy/clock.';
const millisecondsMessage =
  "Read an instant's milliseconds with instantMs from @daisy/clock, or parse the row with postgresInstantMs.";
const digestMessage =
  'Hash only through @daisy/digest (sha3Hex, sha256Hex, hmacSha256Hex and the rest); no hasher or MAC is constructed elsewhere.';

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

/** `new Date(x)` with an argument, directly or through a const. */
function isDateConstruction(node, sourceCode, seen = new Set()) {
  if (node?.type === 'Identifier')
    return isDateConstruction(
      constant(node, sourceCode, seen),
      sourceCode,
      seen,
    );
  return (
    node?.type === 'NewExpression' &&
    node.arguments.length > 0 &&
    isDate(node.callee, sourceCode)
  );
}

const coercingOperators = new Set(['-', '*', '/', '%', '<', '>', '<=', '>=']);

const dateRule = {
  meta: {
    messages: { required: dateMessage, milliseconds: millisecondsMessage },
  },
  create(context) {
    const report = (node) => context.report({ node, messageId: 'required' });
    const constructed = (node) => isDateConstruction(node, context.sourceCode);
    const reportMilliseconds = (node) =>
      context.report({ node, messageId: 'milliseconds' });
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
        const name = property(node, context.sourceCode);
        if (name === 'parse' && isDate(node.object, context.sourceCode))
          report(node);
        if (
          (name === 'getTime' || name === 'valueOf') &&
          constructed(node.object)
        )
          reportMilliseconds(node);
      },
      UnaryExpression(node) {
        if (
          (node.operator === '+' || node.operator === '-') &&
          constructed(node.argument)
        )
          reportMilliseconds(node);
      },
      // Relational and arithmetic coercion: only a Date built in place.
      // A named Date compared with another is ordinary Date work.
      BinaryExpression(node) {
        const inPlace = (side) =>
          side.type === 'NewExpression' && constructed(side);
        if (
          coercingOperators.has(node.operator) &&
          (inPlace(node.left) || inPlace(node.right))
        )
          reportMilliseconds(node);
      },
      CallExpression(node) {
        if (
          isGlobal(node.callee, 'Number', context.sourceCode) &&
          constructed(node.arguments[0])
        )
          reportMilliseconds(node);
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

const nodeHashers = new Set([
  'createHash',
  'createHmac',
  'hash',
  'Hash',
  'Hmac',
]);

function nativeHashName(source, name) {
  return (
    (source === 'bun' && name === 'CryptoHasher') ||
    (['node:crypto', 'crypto'].includes(source) && nodeHashers.has(name))
  );
}

/** A `@noble/hashes` module that hashes; only its byte utilities are not. */
const isNobleHasher = (source) =>
  typeof source === 'string' &&
  /^@noble\/hashes(?:\/|$)/.test(source) &&
  !/^@noble\/hashes\/utils(?:\.js)?$/.test(source);

function isSubtle(node, sourceCode, seen = new Set()) {
  if (node?.type === 'MemberExpression')
    return property(node, sourceCode) === 'subtle';
  if (node?.type !== 'Identifier') return false;
  const [definition] = bindingAt(node, sourceCode)?.defs ?? [];
  if (
    definition?.type === 'Variable' &&
    definition.node.id.type === 'ObjectPattern'
  )
    return definition.node.id.properties.some(
      ({ key, value }) =>
        (value?.type === 'AssignmentPattern' ? value.left : value) ===
          definition.name && (key?.name ?? staticText(key)) === 'subtle',
    );
  return isSubtle(constant(node, sourceCode, seen), sourceCode, seen);
}

/** An argument naming HMAC: `'HMAC'` or `{ name: 'HMAC', … }`. */
const namesHmac = (node, sourceCode) =>
  (typeof staticText(node, sourceCode) === 'string' &&
    staticText(node, sourceCode).toUpperCase() === 'HMAC') ||
  (node?.type === 'ObjectExpression' &&
    node.properties.some(
      (entry) =>
        entry.type === 'Property' &&
        (entry.key.name ?? staticText(entry.key)) === 'name' &&
        String(staticText(entry.value, sourceCode)).toUpperCase() === 'HMAC',
    ));

const webCryptoKeyed = new Set([
  'importKey',
  'generateKey',
  'deriveKey',
  'sign',
  'verify',
]);

function nativeModule(node, sourceCode, seen) {
  if (isGlobal(node, 'Bun', sourceCode)) return 'bun';
  // `(await import('node:crypto')).createHash`, inline or through a const.
  if (node?.type === 'AwaitExpression') node = node.argument;
  if (node?.type === 'ImportExpression')
    return staticText(node.source, sourceCode);
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
    const { sourceCode } = context;
    const report = (node) => context.report({ node, messageId: 'required' });
    const check = (node) => {
      if (isNativeHasher(node.callee, sourceCode)) return report(node);
      if (node.type !== 'CallExpression') return;
      if (
        isGlobal(node.callee, 'require', sourceCode) &&
        isNobleHasher(staticText(node.arguments[0], sourceCode))
      )
        return report(node);
      if (node.callee.type !== 'MemberExpression') return;
      const method = property(node.callee, sourceCode);
      if (!isSubtle(node.callee.object, sourceCode)) return;
      if (
        method === 'digest' ||
        (webCryptoKeyed.has(method) &&
          node.arguments.some((argument) => namesHmac(argument, sourceCode)))
      )
        report(node);
    };
    return {
      ImportDeclaration(node) {
        if (isNobleHasher(node.source.value)) report(node);
      },
      ImportExpression(node) {
        if (isNobleHasher(staticText(node.source, sourceCode))) report(node);
      },
      CallExpression: check,
      NewExpression: check,
    };
  },
};

const plugin = {
  rules: { 'iso-instant': dateRule, 'digest-home': hashRule },
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
    rules: { 'clock-digest/digest-home': 'error' },
  },
];
