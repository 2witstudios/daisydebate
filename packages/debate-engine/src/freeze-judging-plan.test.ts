import { assert, setupRitewayBun, test } from 'riteway/bun';
import { maxUnheardShare, type FrozenCapture } from '@daisy/protocol';
import { freezeJudgingPlan } from './round-panel-completion';
setupRitewayBun();

const limit = maxUnheardShare;
const expectedMs = 1_000_000;
const dispatches = (
  completeness: 'complete' | 'incomplete',
  capture: FrozenCapture,
) =>
  freezeJudgingPlan({
    completeness,
    capture,
    humanJudges: false,
    ballotDeadlineMs: 1,
    aiJudgingBudgetMs: 1,
  }).dispatchAiJudges;
const measured = (unheardMs: number): FrozenCapture => ({
  kind: 'measured',
  unheardMs,
  platformLostMs: 0,
  expectedMs,
});

test('an AI judge rules unless too much speech went unheard', () => {
  const table: readonly [string, boolean, boolean][] = [
    ['a complete transcript', dispatches('complete', measured(0)), true],
    ['a small gap', dispatches('incomplete', measured(1_000)), true],
    [
      'a gap at the limit',
      dispatches('incomplete', measured(expectedMs * limit)),
      true,
    ],
    [
      'a gap past the limit',
      dispatches('incomplete', measured(expectedMs * limit + 1)),
      false,
    ],
    [
      'a stream outside the platform losses with no measure',
      dispatches('incomplete', {
        kind: 'unheard-unmeasured',
        platformLostMs: 0,
        expectedMs,
      }),
      false,
    ],
    [
      'a platform loss with no measure',
      dispatches('incomplete', { kind: 'platform-unmeasured', expectedMs }),
      false,
    ],
  ];
  for (const [given, actual, expected] of table)
    assert({
      given,
      should: expected ? 'dispatch the AI judge' : 'withhold it',
      actual,
      expected,
    });
});
