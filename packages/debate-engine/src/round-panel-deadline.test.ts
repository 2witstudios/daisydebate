import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { decidePanelCompletion, freezeJudgingPlan } from './round-panel-completion';
import {
  oneOnOneRules,
  oneOnOneSeats,
  roundAt,
  runtimeWorld,
} from './runtime.test-support';

setupRitewayBun();
const judges = ['j'.repeat(24), 'k'.repeat(24), 'l'.repeat(24)];
const ballot = (
  judgeParticipantId: string,
  winner: 'affirmative' | 'negative',
) => ({
  judgeParticipantId,
  winner,
  status: 'submitted' as const,
});
const at = (nowMs: number, ballots: ReturnType<typeof ballot>[] = []) =>
  decidePanelCompletion({
    runningAiSeatIds: [],
    failedAiSeatIds: [],
    completeness: 'complete',
    humanJudgeSeatIds: judges,
    judgeSeatIds: judges,
    ballots,
    ballotDeadlineAtMs: 61_000,
    nowMs,
  });

test('the ballot deadline decides when a Round without a full ruling completes (DEC-201)', () => {
  assert({
    given: 'no judge seats',
    should: 'complete at once as unjudged',
    actual: decidePanelCompletion({
      runningAiSeatIds: [],
      failedAiSeatIds: [],
      completeness: 'complete',
      humanJudgeSeatIds: [],
      judgeSeatIds: [],
      ballots: [],
      ballotDeadlineAtMs: Number.NaN,
      nowMs: 1_000,
    }),
    expected: {
      kind: 'complete',
      ruling: 'unjudged',
      outcome: null,
      noRuling: [],
    },
  });
  assert({
    given: 'judges still inside the deadline, and every judge already ruled',
    should: 'leave completion to the ballots',
    actual: [
      at(60_999, [ballot(judges[0]!, 'negative')]),
      at(
        99_000,
        judges.map((j) => ballot(j, 'affirmative')),
      ),
    ],
    expected: [{ kind: 'pending' }, { kind: 'pending' }],
  });
  assert({
    given: 'the deadline passed with no ballot',
    should: 'complete with no winner and every judge recorded as no ruling',
    actual: at(61_000),
    expected: {
      kind: 'complete',
      ruling: 'judges-did-not-rule',
      outcome: null,
      noRuling: judges,
    },
  });
  assert({
    given: 'the deadline passed with two of three ballots, unanimous and split',
    should:
      'take a winner from the submitted ballots, but never let the absent ruling make a draw',
    actual: [
      at(61_000, [
        ballot(judges[0]!, 'negative'),
        ballot(judges[2]!, 'negative'),
      ]),
      at(61_000, [
        ballot(judges[0]!, 'negative'),
        ballot(judges[1]!, 'affirmative'),
      ]),
    ],
    expected: [
      {
        kind: 'complete',
        ruling: 'partial',
        outcome: 'negative',
        noRuling: [judges[1]],
      },
      {
        kind: 'complete',
        ruling: 'judges-did-not-rule',
        outcome: null,
        noRuling: [judges[2]],
      },
    ],
  });
});

const rules = oneOnOneRules();
const judge = oneOnOneSeats.find((seat) => seat.role === 'judge')!;
const total = rules.segments.reduce(
  (sum, s) => sum + s.durationMs + rules.countdownMs,
  0,
);
const judged = () => {
  const world = runtimeWorld();
  world.execute({ command: { type: 'start' }, actorId: null, now: roundAt(0) });
  world.tick(roundAt(total));
  return world;
};
const completion = (nowMs: number) => ({
  now: roundAt(nowMs),
  ballots: [],
  ballotDeadlineAt: roundAt(total + 1_800_000),
  completeness: 'complete' as const,
  humanJudgeSeatIds: [judge.id],
  runningAiSeatIds: [],
  failedAiSeatIds: [],
});

test('a judged Round completes without a winner only after its ballot deadline', async () => {
  const early = judged();
  const before = early.position(roundAt(total + 1_799_999));
  await assertRejects({
    given: 'a judged Round one millisecond before its ballot deadline',
    should: 'refuse and preserve the Round',
    actual: () => early.completePanel(completion(total + 1_799_999)),
    code: 'INVARIANT',
    invariantId: 'round.complete.panel-played-round',
  });
  assert({
    given: 'that refusal',
    should: 'change nothing',
    actual: early.position(roundAt(total + 1_799_999)),
    expected: before,
  });
  const result = judged().completePanel(completion(total + 1_800_000));
  assert({
    given: `the judge seat ${judge.id} silent past its deadline`,
    should: 'complete with a null outcome and no fabricated ballot',
    actual: [result.round?.status, result.round?.outcome, result.effects],
    expected: [
      'completed',
      null,
      [
        {
          kind: 'round_completed',
          outcome: null,
          at: roundAt(total + 1_800_000),
        },
      ],
    ],
  });
});

test('an incomplete freeze dispatches no AI judge and, with no human judge, closes the ruling window (DEC-208)', () => {
  const plan = (
    completeness: 'complete' | 'incomplete',
    humanJudges: boolean,
  ) =>
    freezeJudgingPlan({
      completeness,
      humanJudges,
      ballotDeadlineMs: 1_800_000,
      aiJudgingBudgetMs: 300_000,
    });
  assert({
    given: 'complete and incomplete freezes, with and without a human judge',
    should:
      'dispatch AI judging only on a complete freeze and keep the window only for human judges',
    actual: [
      plan('complete', false),
      plan('incomplete', true),
      plan('incomplete', false),
    ],
    expected: [
      {
        dispatchAiJudges: true,
        ballotDeadlineMs: null,
        aiJudgingBudgetMs: 300_000,
      },
      {
        dispatchAiJudges: false,
        ballotDeadlineMs: 1_800_000,
        aiJudgingBudgetMs: 300_000,
      },
      {
        dispatchAiJudges: false,
        ballotDeadlineMs: null,
        aiJudgingBudgetMs: 300_000,
      },
    ],
  });
  const decide = (
    completeness: 'complete' | 'incomplete',
    humanJudges: boolean,
  ) =>
    decidePanelCompletion({
      runningAiSeatIds: [],
      failedAiSeatIds: [],
      completeness,
      humanJudgeSeatIds: humanJudges ? [judges[0]!] : [],
      judgeSeatIds: [judges[0]!],
      ballots: [],
      ballotDeadlineAtMs: 61_000,
      nowMs: 61_000,
    });
  assert({
    given:
      'no ruling past the deadline on an AI-only incomplete freeze, and otherwise',
    should:
      'record the transcript as incomplete only when no judge could fairly rule',
    actual: [
      decide('incomplete', false),
      decide('incomplete', true),
      decide('complete', false),
    ].map((d) => (d.kind === 'complete' ? d.ruling : d.kind)),
    expected: [
      'transcript-incomplete',
      'judges-did-not-rule',
      'judges-did-not-rule',
    ],
  });
});

test('an incomplete freeze completes once every human judge has ruled decisively (ISSUE-466-r2)', () => {
  const [human, ai, other] = judges as [string, string, string];
  const decide = (
    humanJudgeSeatIds: readonly string[],
    ballots: ReturnType<typeof ballot>[],
    completeness: 'complete' | 'incomplete' = 'incomplete',
  ) =>
    decidePanelCompletion({
      runningAiSeatIds: [],
      failedAiSeatIds: [],
      completeness,
      humanJudgeSeatIds,
      judgeSeatIds: [human, ai],
      ballots,
      ballotDeadlineAtMs: 61_000,
      nowMs: 1_000,
    });
  assert({
    given:
      'a human and an AI judge before the deadline: the human ruled on an incomplete freeze, has not ruled, ruled on a complete freeze, and two humans split',
    should:
      'complete with the human ruling and the AI seat as no ruling only once every human ruled decisively on an incomplete freeze; otherwise keep waiting',
    actual: [
      decide([human], [ballot(human, 'negative')]),
      decide([human], []),
      decidePanelCompletion({
        completeness: 'complete',
        humanJudgeSeatIds: [human],
        judgeSeatIds: [human, ai],
        runningAiSeatIds: [ai],
        failedAiSeatIds: [],
        ballots: [ballot(human, 'negative')],
        ballotDeadlineAtMs: 61_000,
        nowMs: 1_000,
      }),
      decidePanelCompletion({
        runningAiSeatIds: [],
        failedAiSeatIds: [],
        completeness: 'incomplete',
        humanJudgeSeatIds: [human, other],
        judgeSeatIds: [human, other, ai],
        ballots: [ballot(human, 'negative'), ballot(other, 'affirmative')],
        ballotDeadlineAtMs: 61_000,
        nowMs: 1_000,
      }).kind,
    ],
    expected: [
      {
        kind: 'complete',
        ruling: 'partial',
        outcome: 'negative',
        noRuling: [ai],
      },
      { kind: 'pending' },
      { kind: 'pending' },
      'pending',
    ],
  });
});

test('the panel decides from each seat: every mode ends, and only a judge who can still rule holds it', () => {
  const [human, ai, other] = judges as [string, string, string];
  const decide = (input: {
    readonly humans?: readonly string[];
    readonly seats: readonly string[];
    readonly running?: readonly string[];
    readonly failed?: readonly string[];
    readonly ballots?: ReturnType<typeof ballot>[];
    readonly completeness?: 'complete' | 'incomplete';
    readonly deadline?: number;
  }) =>
    decidePanelCompletion({
      completeness: input.completeness ?? 'complete',
      humanJudgeSeatIds: input.humans ?? [],
      judgeSeatIds: input.seats,
      runningAiSeatIds: input.running ?? [],
      failedAiSeatIds: input.failed ?? [],
      ballots: input.ballots ?? [],
      ballotDeadlineAtMs: input.deadline ?? Number.NaN,
      nowMs: 1_000,
    });
  const summary = (d: ReturnType<typeof decide>) =>
    d.kind === 'pending' ? 'pending' : `${d.ruling}:${d.outcome}`;
  const later = 61_000;
  const cases: [string, Parameters<typeof decide>[0], string][] = [
    ['AI-only, job running', { seats: [ai], running: [ai] }, 'pending'],
    [
      'AI-only, job failed: ends at once with no 30 minute wait',
      { seats: [ai], failed: [ai] },
      'judging-failed:null',
    ],
    [
      'AI-only, incomplete freeze',
      { seats: [ai], completeness: 'incomplete' },
      'transcript-incomplete:null',
    ],
    [
      'two AI seats, one failed and one still running',
      { seats: [ai, other], running: [other], failed: [ai] },
      'pending',
    ],
    [
      'two AI seats, one failed and one ruled',
      {
        seats: [ai, other],
        failed: [ai],
        ballots: [ballot(other, 'negative')],
      },
      'partial:negative',
    ],
    [
      'mixed, AI failed, human inside the window: the human keeps it',
      { humans: [human], seats: [human, ai], failed: [ai], deadline: later },
      'pending',
    ],
    [
      'mixed, AI failed, human ruled: no wait for the dead seat',
      {
        humans: [human],
        seats: [human, ai],
        failed: [ai],
        deadline: later,
        ballots: [ballot(human, 'affirmative')],
      },
      'partial:affirmative',
    ],
    [
      'mixed, AI failed, human window over with no ballot',
      { humans: [human], seats: [human, ai], failed: [ai], deadline: 1_000 },
      'judges-did-not-rule:null',
    ],
    [
      'mixed, human window over, AI still running',
      { humans: [human], seats: [human, ai], running: [ai], deadline: 1_000 },
      'pending',
    ],
    [
      'a tied panel with nobody left to rule',
      {
        seats: [ai, other],
        ballots: [ballot(ai, 'negative'), ballot(other, 'affirmative')],
      },
      'pending',
    ],
    [
      'a tied panel of three with one failed seat',
      {
        seats: [ai, other, human],
        failed: [human],
        ballots: [ballot(ai, 'negative'), ballot(other, 'affirmative')],
      },
      'judging-failed:null',
    ],
  ];
  for (const [given, input, expected] of cases)
    assert({
      given,
      should: `decide ${expected}`,
      actual: summary(decide(input)),
      expected,
    });
});
