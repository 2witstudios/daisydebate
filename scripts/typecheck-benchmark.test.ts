import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  configsForScript,
  sameDiagnostics,
  parseMeasurement,
} from './typecheck-benchmark';

setupRitewayBun();

describe('typecheck benchmark evidence', () => {
  test('includes production and test projects behind task wrappers', () => {
    assert({
      given: 'a workspace task with a separate test config',
      should: 'measure both unchanged compiler projects',
      actual: configsForScript(
        'packages/protocol',
        'tsc --noEmit && tsc --noEmit -p tsconfig.test.json',
      ),
      expected: [
        'packages/protocol/tsconfig.json',
        'packages/protocol/tsconfig.test.json',
      ],
    });
    assert({
      given: 'the Next typegen and heavy-queue wrapper',
      should: 'select the web project without replacing typegen',
      actual: configsForScript(
        'apps/web',
        "bun ../../scripts/heavy.ts sh -c 'next typegen && tsc --noEmit'",
      ),
      expected: ['apps/web/tsconfig.json'],
    });
  });
  test('compares diagnostics without hiding changed codes, locations or text', () => {
    const diagnostic =
      'src/a.ts(1,7): error TS2322: Type string is not assignable to number.';
    for (const [other, equivalent] of [
      [`${diagnostic}\r\n`, true],
      [diagnostic.replace('2322', '2345'), false],
      [diagnostic.replace('(1,7)', '(2,7)'), false],
      [diagnostic.replace('string', 'boolean'), false],
      ['', false],
    ] as const) {
      assert({
        given: `compiler output ${JSON.stringify(other)}`,
        should: 'preserve every diagnostic distinction',
        actual: sameDiagnostics(diagnostic, other),
        expected: equivalent,
      });
    }
  });
  test('keeps time and peak RSS units explicit even on compiler failure', () => {
    assert({
      given: 'GNU time output after a rejected program',
      should: 'retain seconds, KiB and exit status',
      actual: parseMeasurement(
        'Command exited with non-zero status 2\n1.25\t123456\t2\n',
      ),
      expected: { seconds: 1.25, peakRssKiB: 123456, exitCode: 2 },
    });
  });
});
