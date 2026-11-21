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
