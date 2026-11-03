import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundIncidentPolicy } from '@daisy/protocol';
import { freezeJudgingPlan } from './round-panel-completion';
setupRitewayBun();

const limit = roundIncidentPolicy.maxCaptureGapShare;
const expectedMs = 1_000_000;
const plan = (
  completeness: 'complete' | 'incomplete',
  gapMs: number | null,
  humanJudges = false,
  platformLostAudio = true,
) => {
  const { dispatchAiJudges, endsAsPlatformIncident } = freezeJudgingPlan({
    completeness,
    capture: { gapMs, expectedMs, platformLostAudio },
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
      plan('incomplete', expectedMs, false, false),
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
