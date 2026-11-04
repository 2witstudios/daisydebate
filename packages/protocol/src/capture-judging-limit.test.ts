import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  frozenCaptureColumns,
  frozenCaptureOf,
  maxUnheardShare,
  platformLostTooMuch,
  type FrozenCapture,
} from './capture-judging-limit';
setupRitewayBun();

const expectedMs = 1_000_000;
const limit = expectedMs * maxUnheardShare;

test('only the platform losing too much is the platform failing', () => {
  const table: readonly [string, FrozenCapture, boolean][] = [
    [
      'platform loss past the limit',
      {
        kind: 'measured',
        unheardMs: limit + 1,
        platformLostMs: limit + 1,
        expectedMs,
      },
      true,
    ],
    [
      'silence past the limit and a lossless takeover',
      {
        kind: 'measured',
        unheardMs: expectedMs,
        platformLostMs: 0,
        expectedMs,
      },
      false,
    ],
    [
      'platform loss under the limit that silence tips over',
      {
        kind: 'measured',
        unheardMs: limit + 1,
        platformLostMs: limit - 1,
        expectedMs,
      },
      false,
    ],
    [
      'a stream elsewhere with no measure, and nothing lost',
      { kind: 'unheard-unmeasured', platformLostMs: 0, expectedMs },
      false,
    ],
    [
      'a stream elsewhere with no measure, and platform loss past the limit',
      { kind: 'unheard-unmeasured', platformLostMs: expectedMs, expectedMs },
      true,
    ],
    [
      'a platform loss with no measure',
      { kind: 'platform-unmeasured', expectedMs },
      true,
    ],
    [
      'nothing owed and nothing lost',
      { kind: 'measured', unheardMs: 0, platformLostMs: 0, expectedMs: 0 },
      false,
    ],
  ];
  for (const [given, capture, expected] of table)
    assert({
      given,
      should: expected ? 'be the platform failing' : 'not be',
      actual: platformLostTooMuch(capture),
      expected,
    });
});

test('a freeze row holds each kind exactly', () => {
  const kinds: readonly FrozenCapture[] = [
    { kind: 'measured', unheardMs: 5, platformLostMs: 2, expectedMs },
    { kind: 'unheard-unmeasured', platformLostMs: 2, expectedMs },
    { kind: 'platform-unmeasured', expectedMs },
  ];
  assert({
    given: 'each kind through its columns and back',
    should: 'come back the same',
    actual: kinds.map((kind) => frozenCaptureOf(frozenCaptureColumns(kind))),
    expected: kinds,
  });
});
