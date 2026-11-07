import type { FreeBindingReleaseFacts } from '@daisy/protocol/billing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { UsageState } from '@daisy/protocol/billing';
import { canReleaseFreeJudgeBinding } from './free-judge-binding';

setupRitewayBun();
const at = '2026-11-05T00:00:00.000Z';
const released: UsageState = { kind: 'released', releasedAt: at };
const facts: FreeBindingReleaseFacts = {
  boundRoundId: 'original',
  roundId: 'original',
  abandoned: true,
  bot: released,
  judge: { kind: 'selected', state: released },
};
const states: readonly (UsageState | null)[] = [
  null,
  { kind: 'reserved' },
  { kind: 'dispatched', countedAt: at, countBasis: 'dispatch_record' },
  { kind: 'unknown', countedAt: at, countBasis: 'dispatch_record' },
  { kind: 'delivered', countedAt: at, countBasis: 'dispatch_record' },
  {
    kind: 'refunded',
    countedAt: at,
    countBasis: 'dispatch_record',
    refundedAt: at,
  },
  {
    kind: 'credited',
    countedAt: at,
    countBasis: 'dispatch_record',
    creditedAt: at,
    provenance: { kind: 'recovery_bound', incidentId: 'incident' },
    providerOutcome: 'unknown',
  },
  released,
];

test('only the fully released selected bundle can clear a matching abandoned Round binding', () => {
  assert({
    given:
      'every bot and selected judge accounting-state combination, including missing and uncertain work',
    should:
      'clear only the released/released pair; retain every counted, refunded or credited binding',
    actual: states.map((bot) =>
      states.map((judge) =>
        canReleaseFreeJudgeBinding({
          ...facts,
          bot,
          judge:
            judge === null
              ? { kind: 'missing' }
              : { kind: 'selected', state: judge },
        }),
      ),
    ),
    expected: states.map((_, bot) =>
      states.map((_, judge) => bot === 7 && judge === 7),
    ),
  });
});

test('an optional unselected judge needs no fabricated reservation but closure and identity are mandatory', () => {
  assert({
    given:
      'an unselected optional judge, missing selected reservation, live Round or mismatched binding',
    should:
      'clear only the matching abandoned, released bot with a known unselected judge',
    actual: [
      canReleaseFreeJudgeBinding({ ...facts, judge: { kind: 'unselected' } }),
      canReleaseFreeJudgeBinding({ ...facts, judge: { kind: 'missing' } }),
      canReleaseFreeJudgeBinding({ ...facts, abandoned: false }),
      canReleaseFreeJudgeBinding({ ...facts, boundRoundId: 'replacement' }),
      canReleaseFreeJudgeBinding({ ...facts, boundRoundId: null }),
    ],
    expected: [true, false, false, false, false],
  });
});
