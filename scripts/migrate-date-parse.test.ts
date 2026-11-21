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
    '  if (!Number.isFinite(expiresAt)) return refused;',
    '  return expiresAt;',
    '}',
  ].join('\n');
  const expected = [
    "import { instantMs as clockInstantMs, tryInstantMs, instantMs as readInstant } from '@daisy/clock';",
    'export const read = (readInstant: unknown) => clockInstantMs(input);',
    'export function check(clock: Clock) {',
    '  const expiresAt = (tryInstantMs(clock.now()) ?? Number.NaN);',
    '  if (!Number.isFinite(expiresAt)) return refused;',
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
