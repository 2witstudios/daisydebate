import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { formatChangeLine } from './format-changes';

setupRitewayBun();

describe('formatChangeLine', () => {
  test('timings', () => {
    assert({
      given: 'a shorter speech, prep switched off and prep before the round on',
      should: 'read as before → after in clock time, saying off for none',
      actual: [
        formatChangeLine({
          kind: 'segment-duration',
          key: '1AC',
          fromMs: 480_000,
          toMs: 360_000,
        }),
        formatChangeLine({
          kind: 'in-round-prep',
          fromMs: 240_000,
          toMs: null,
        }),
        formatChangeLine({
          kind: 'pre-round-prep',
          fromMs: null,
          toMs: 1_200_000,
        }),
        formatChangeLine({ kind: 'countdown', fromMs: 10_000, toMs: 0 }),
      ],
      expected: [
        '1AC 8:00 → 6:00',
        'Prep per side 4:00 → off',
        'Prep before the round off → 20:00',
        'Countdown 0:10 → 0:00',
      ],
    });
  });

  test('structure and interaction', () => {
    assert({
      given: 'seat, speech and interaction changes',
      should: 'name each in the room’s vocabulary, Aff and Neg for sides',
      actual: [
        formatChangeLine({ kind: 'seats', role: 'judge', from: 1, to: 3 }),
        formatChangeLine({
          kind: 'seats',
          role: 'affirmative',
          from: 1,
          to: 2,
        }),
        formatChangeLine({
          kind: 'segments',
          added: ['3AR'],
          removed: ['2AR'],
          changed: ['NC'],
        }),
        formatChangeLine({
          kind: 'cross-ex-mode',
          from: 'ordered',
          to: 'free',
        }),
        formatChangeLine({
          kind: 'interruptions',
          from: { allowed: 'cross_ex_only', minRemainingMs: 30_000 },
          to: { allowed: 'disabled', minRemainingMs: 0 },
        }),
        formatChangeLine({
          kind: 'yield',
          from: { allowed: true, returnsTime: true },
          to: null,
        }),
        formatChangeLine({
          kind: 'resolution-draw',
          from: {
            enabled: true,
            drawSize: 5,
            strikeWindowMs: 60_000,
            firstStriker: 'negative',
            source: { kind: 'bank', categories: ['policy', 'value', 'fact'] },
          },
          to: { enabled: false },
        }),
        formatChangeLine({
          kind: 'resolution-draw',
          from: { enabled: false },
          to: {
            enabled: true,
            drawSize: 3,
            strikeWindowMs: 90_000,
            firstStriker: 'affirmative',
            source: { kind: 'host', count: 4 },
          },
        }),
      ],
      expected: [
        'Judges 1 → 3',
        'Aff debaters 1 → 2',
        'Speeches added 3AR · removed 2AR · changed NC',
        'Cross-examination: Questioner leads → Open floor',
        'Interruptions: Only during cross-examination → Off',
        'Ending a speech early: on → off',
        'Resolution strike: 5 from Daisy’s Policy, Value and Fact resolutions · Negative strikes first · 1:00 per strike → off',
        'Resolution strike: off → 3 from the host’s list · Affirmative strikes first · 1:30 per strike',
      ],
    });
  });
});
