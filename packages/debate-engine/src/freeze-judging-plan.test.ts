import { assert, setupRitewayBun, test } from 'riteway/bun';
import { maxUnheardShare } from '@daisy/protocol';
import { freezeJudgingPlan } from './round-panel-completion';
setupRitewayBun();

const limit = maxUnheardShare;
const expectedMs = 1_000_000;
const plan = (
  completeness: 'complete' | 'incomplete',
  unheardMs: number | null,
  humanJudges = false,
  platformLostMs: number | null = unheardMs,
  platformLostUnmeasured = unheardMs === null,
) => {
  const { dispatchAiJudges, endsAsPlatformIncident } = freezeJudgingPlan({
    completeness,
    capture: { unheardMs, platformLostMs, expectedMs, platformLostUnmeasured },
    humanJudges,
    ballotDeadlineMs: 1,
    aiJudgingBudgetMs: 1,
  });
  return { dispatchAiJudges, endsAsPlatformIncident };
};

test('the dispatch rule follows the capture limit', () => {
  const judged = { dispatchAiJudges: true, endsAsPlatformIncident: false };
  const ended = { dispatchAiJudges: false, endsAsPlatformIncident: true };
  const table: readonly [string, ReturnType<typeof plan>, typeof judged][] = [
    ['a complete transcript', plan('complete', 0), judged],
    ['a small gap', plan('incomplete', 1_000), judged],
    ['a gap at the limit', plan('incomplete', expectedMs * limit), judged],
    [
      'a gap past the limit, on an AI-only panel',
      plan('incomplete', expectedMs * limit + 1),
      ended,
    ],
    [
      'a shortfall nobody measured, which cannot be proven small',
      plan('incomplete', null),
      ended,
    ],
    [
      'a silent seat on an AI-only panel, which is no failure of the platform',
      plan('incomplete', expectedMs, false, 0),
      { dispatchAiJudges: false, endsAsPlatformIncident: false },
    ],
    [
      'a lossless takeover plus a seat silent past the limit, which the platform did not cause',
      plan('incomplete', expectedMs * limit + 1, false, 0),
      { dispatchAiJudges: false, endsAsPlatformIncident: false },
    ],
    [
      'history with no measure and no platform loss',
      plan('incomplete', null, false, null, false),
      { dispatchAiJudges: false, endsAsPlatformIncident: false },
    ],
    [
      'a gap past the limit with a human judge, who heard it live',
      plan('incomplete', expectedMs, true),
      { dispatchAiJudges: false, endsAsPlatformIncident: false },
    ],
  ];
  for (const [given, actual, expected] of table)
    assert({
      given,
      should: `plan ${JSON.stringify(expected)}`,
      actual,
      expected,
    });
});
