import { runInNewContext } from 'node:vm';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { migrateDateParse } from './migrate-date-parse';

setupRitewayBun();

describe('the clock migration', () => {
  test('migrates arithmetic, injected clocks, validation, and computed calls', () => {
    const source = [
      "'use client';",
      "import { fixedClock } from '@daisy/clock';",
      'const instantMs = 1;',
      'const same = Date["parse"](input);',
      'const ms = Date.parse(clock.now());',
      'const valid = Number.isFinite(Date.parse(input));',
      'const invalid = Number.isNaN(Date.parse(input));',
      'const earlier = new Date(Date.parse(input) - span).toISOString();',
      'const label = "Date.parse()";',
      '// Date.parse(input)',
    ].join('\n');
    const migrated = migrateDateParse('example.ts', source);
    assert({
      given:
        'each migration shape with a conflicting name, a directive and untouched prose',
      should: 'route each through its clock helper and be idempotent',
      actual: [migrated, migrateDateParse('example.ts', migrated)],
      expected: [
        [
          "'use client';",
          "import { instantMs as clockInstantMs, nowMs, tryInstantMs, addMs, fixedClock } from '@daisy/clock';",
          'const instantMs = 1;',
          'const same = clockInstantMs(input);',
          'const ms = nowMs(clock);',
          'const valid = (tryInstantMs(input) !== undefined);',
          'const invalid = (tryInstantMs(input) === undefined);',
          'const earlier = addMs(input, -(span));',
          'const label = "Date.parse()";',
          '// Date.parse(input)',
        ].join('\n'),
      ].flatMap((expected) => [expected, expected]),
    });
  });
});

test('avoids shadowed imports and preserves a separate parse guard', () => {
  const source = [
    "import { instantMs as readInstant } from '@daisy/clock';",
    'export const read = (readInstant: unknown) => globalThis.Date.parse(input);',
    'export function check(clock: Clock) {',
    '  const expiresAt = Date.parse(clock.now());',
    '  if (!Number.isFinite((expiresAt))) return refused;',
    '  return expiresAt;',
    '}',
  ].join('\n');
  const expected = [
    "import { instantMs as clockInstantMs, tryInstantMs, instantMs as readInstant } from '@daisy/clock';",
    'export const read = (readInstant: unknown) => clockInstantMs(input);',
    'export function check(clock: Clock) {',
    '  const expiresAt = (tryInstantMs(clock.now()) ?? 0 / 0);',
    '  if (!Number.isFinite((expiresAt))) return refused;',
    '  return expiresAt;',
    '}',
  ].join('\n');
  const migrated = migrateDateParse('example.ts', source);
  assert({
    given:
      'a shadowed helper, a global Date access and a separately checked injected-clock result',
    should:
      'use an unshadowed helper and keep the refusal reachable in one pass',
    actual: [migrated, migrateDateParse('example.ts', migrated)],
    expected: [expected, expected],
  });
});

test('rewrites parenthesized inline guards and constant computed Date members', () => {
  const source = [
    "const method = 'parse';",
    'const date = Date;',
    'export const valid = Number.isFinite((Date.parse(clock.now())));',
    'export const computed = date[method](input);',
    'export function localNumber(Number: Numeric) { const stamp = Date.parse(clock.now()); return Number.isFinite(stamp); }',
    'export const local = (Date: Parser) => { const date = Date; return date[method](input); };',
  ].join('\n');
  const expected = [
    "import { tryInstantMs, instantMs, nowMs } from '@daisy/clock';",
    "const method = 'parse';",
    'const date = Date;',
    'export const valid = (tryInstantMs(clock.now()) !== undefined);',
    'export const computed = instantMs(input);',
    'export function localNumber(Number: Numeric) { const stamp = nowMs(clock); return Number.isFinite(stamp); }',
    'export const local = (Date: Parser) => { const date = Date; return date[method](input); };',
  ].join('\n');
  const migrated = migrateDateParse('example.ts', source);
  assert({
    given:
      'a parenthesized parse guard, a constant member name and a locally supplied Date',
    should:
      'preserve the refusal, migrate the global call and leave the local call in place',
    actual: [migrated, migrateDateParse('example.ts', migrated)],
    expected: [expected, expected],
  });
});

test('flags a compound destructuring for manual conversion', () => {
  const source = 'export const { parse, UTC } = globalThis.Date;';
  let needsManualConversion = false;
  const migrated = migrateDateParse('example.ts', source, () => {
    needsManualConversion = true;
  });
  assert({
    given: 'a parse binding grouped with other native Date bindings',
    should:
      'leave the compound binding in place and flag it for manual conversion',
    actual: [migrated, needsManualConversion],
    expected: [source, true],
  });
});

test('keeps numeric refusals across independent lexical scopes', () => {
  const source = [
    'let stamp = 0;',
    '{ const Number = { NaN: 0 }; void Number; stamp = Date.parse(input); }',
    'export const refused = Number.isNaN(stamp);',
  ].join('\n');
  const migrated = migrateDateParse('example.js', source);
  assert({
    given: 'an assignment and a guarded use under different Number bindings',
    should: 'provide an invalid sentinel independent of lexical bindings',
    actual: migrated.includes('tryInstantMs(input) ?? 0 / 0'),
    expected: true,
  });
});

test('reports a destructured parser whose calls can rely on NaN', () => {
  const source =
    'const { parse } = Date; export const refused = Number.isNaN(parse(input));';
  let manual = false;
  const migrated = migrateDateParse('example.mjs', source, () => {
    manual = true;
  });
  const refused = runInNewContext(
    migrated.replace('export const refused =', ''),
    { input: 'invalid' },
  );
  assert({
    given: 'an alias whose caller uses the original numeric sentinel',
    should: 'leave the binding and report it for manual conversion',
    actual: [migrated, manual, refused],
    expected: [source, true, true],
  });
});

test('keeps a local Date binding in JavaScript', () => {
  const source =
    'export function custom(Date, value) { return Date.parse(value); }';
  assert({
    given: 'a caller-supplied Date parameter in JavaScript',
    should: 'preserve that binding in both JavaScript module formats',
    actual: ['example.js', 'example.mjs'].map((path) =>
      migrateDateParse(path, source),
    ),
    expected: [source, source],
  });
});

test('reports assigned or extracted Date parsers without changing their refusals', () => {
  const forms = ['let parse; ({ parse } = Date);', 'const parse = Date.parse;'];
  const results = forms.map((prefix) => {
    const source = `${prefix} Number.isNaN(parse(input));`;
    let manual = false;
    const migrated = migrateDateParse('example.js', source, () => {
      manual = true;
    });
    return [
      migrated === source,
      manual,
      runInNewContext(migrated, { input: 'invalid' }),
    ];
  });
  assert({
    given:
      'native parsers captured by assignment destructuring or a direct reference',
    should: 'report both native bindings and retain numeric refusal',
    actual: results,
    expected: [
      [true, true, true],
      [true, true, true],
    ],
  });
});

test('reports CommonJS clock calls for manual conversion', () => {
  const source = 'module.exports = Date.parse(input);';
  let manual = false;
  const migrated = migrateDateParse('sample.cjs', source, () => {
    manual = true;
  });
  assert({
    given: 'a CommonJS source with an otherwise supported Date.parse call',
    should: 'report its manual disposition and keep its module format',
    actual: [migrated, manual],
    expected: [source, true],
  });
});

test('distinguishes CommonJS exports from locally bound names in JavaScript', () => {
  const scenarios = [
    { source: 'module.exports = Date.parse(input);', manual: true },
    { source: "module['exports'] = Date.parse(input);", manual: true },
    { source: 'exports.stamp = Date.parse(input);', manual: true },
    {
      source:
        'function publish(module) { module.exports = Date.parse(input); }',
      manual: false,
    },
    {
      source:
        'function publish(exports) { exports.stamp = Date.parse(input); }',
      manual: false,
    },
  ];
  assert({
    given:
      'export-only CommonJS files and shadowed module and exports parameters',
    should:
      'preserve actual CommonJS source and migrate the locally bound controls',
    actual: scenarios.map(({ source }) => {
      let manual = false;
      const migrated = migrateDateParse('sample.js', source, () => {
        manual = true;
      });
      return [manual, migrated === source];
    }),
    expected: scenarios.map(({ manual }) => [manual, manual]),
  });
});
