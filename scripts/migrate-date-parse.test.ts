import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { migrateDateParse } from './migrate-date-parse';

setupRitewayBun();

describe('the clock migration', () => {
  test('migrates arithmetic, injected clocks, validation, and standalone references', () => {
    const source = [
      "'use client';",
      "import { fixedClock } from '@daisy/clock';",
      'const instantMs = 1;',
      'const same = Date["parse"];',
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
          'const same = clockInstantMs;',
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
    '  const expiresAt = (tryInstantMs(clock.now()) ?? Number.NaN);',
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
    'export const { [method]: parse } = globalThis.Date;',
    'export function localNumber(Number: Numeric) { const stamp = Date.parse(clock.now()); return Number.isFinite(stamp); }',
    'export const local = (Date: Parser) => { const date = Date; return date[method](input); };',
  ].join('\n');
  const expected = [
    "import { tryInstantMs, instantMs, nowMs } from '@daisy/clock';",
    "const method = 'parse';",
    'const date = Date;',
    'export const valid = (tryInstantMs(clock.now()) !== undefined);',
    'export const computed = instantMs(input);',
    'export const parse = instantMs;',
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
