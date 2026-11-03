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
  platformLostMs: number = unheardMs ?? 0,
) => {
  const { dispatchAiJudges, endsAsPlatformIncident } = freezeJudgingPlan({
    completeness,
    capture:
      unheardMs === null
        ? { kind: 'platform-unmeasured', expectedMs }
        : { kind: 'measured', unheardMs, platformLostMs, expectedMs },
    humanJudges,
    ballotDeadlineMs: 1,
    aiJudgingBudgetMs: 1,
  });
  return { dispatchAiJudges, endsAsPlatformIncident };
};

test('a stream with no measure that is no fault of the platform', () => {
  const unmeasuredElsewhere = (platformLostMs: number) =>
    freezeJudgingPlan({
      completeness: 'incomplete',
      capture: { kind: 'unheard-unmeasured', platformLostMs, expectedMs },
      humanJudges: false,
      ballotDeadlineMs: 1,
      aiJudgingBudgetMs: 1,
    });
  assert({
    given: 'no platform loss, then platform loss past the limit',
    should:
      'withhold the judge both times, and end on the platform only for the second',
    actual: [unmeasuredElsewhere(0), unmeasuredElsewhere(expectedMs)].map(
      ({ dispatchAiJudges, endsAsPlatformIncident }) => [
        dispatchAiJudges,
        endsAsPlatformIncident,
      ],
    ),
    expected: [
      [false, false],
      [false, true],
    ],
  });
});

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
      'platform loss under the limit tipped over by silence, stated in ADR 0110',
      plan('incomplete', expectedMs * limit + 1, false, expectedMs * limit - 1),
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
