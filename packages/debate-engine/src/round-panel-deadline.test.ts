import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import type { JudgingPanel } from '@daisy/protocol';
import {
  decidePanelCompletion,
  freezeJudgingPlan,
  judgingPanelOf,
} from './round-panel-completion';
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
});
const iso = (ms: number) => new Date(ms).toISOString();
const deadline = iso(61_000);
const window = (seatIds: readonly string[], deadlineAt = deadline) => {
  const [first, ...rest] = seatIds;
  return first === undefined
    ? null
    : { deadlineAt, seatIds: [first, ...rest] as [string, ...string[]] };
};
const standing = (
  id: string,
  state: 'ended' | 'holding_ballot' | 'not_dispatched',
) => ({
  id,
  standing: { state },
});
const running = (id: string) => ({
  id,
  standing: { state: 'generating' as const, deadlineAt: iso(90_000) },
});
const at = (nowMs: number, ballots: ReturnType<typeof ballot>[] = []) =>
  decidePanelCompletion({
    completeness: 'complete',
    panel: { humanWindow: window(judges), aiSeats: [] },
    ballots,
    nowMs,
  });

test('the ballot deadline decides when a Round without a full ruling completes (DEC-201)', () => {
  assert({
    given: 'no judge seats',
    should: 'complete at once as unjudged',
    actual: decidePanelCompletion({
      completeness: 'complete',
      panel: { humanWindow: null, aiSeats: [] },
      ballots: [],
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
    should: 'wait for the unruled judge, and complete once none is left',
    actual: [
      at(60_999, [ballot(judges[0]!, 'negative')]),
      at(
        99_000,
        judges.map((j) => ballot(j, 'affirmative')),
      ),
    ],
    expected: [
      {
        kind: 'pending',
        waiting: { on: 'human_window', deadlineAt: deadline },
      },
      {
        kind: 'complete',
        ruling: 'ruled',
        outcome: 'affirmative',
        noRuling: [],
      },
    ],
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
  world.activate({ at: roundAt(0), now: roundAt(0) });
  world.tick(roundAt(total));
  return world;
};
const completion = (nowMs: number) => ({
  now: roundAt(nowMs),
  ballots: [],
  completeness: 'complete' as const,
  panel: {
    humanWindow: window([judge.id], roundAt(total + 1_800_000)),
    aiSeats: [],
  },
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

test('a freeze of unmeasured loss dispatches no AI judge and, with no human judge, closes the ruling window (DEC-208)', () => {
  const plan = (
    completeness: 'complete' | 'incomplete',
    humanJudges: boolean,
  ) =>
    freezeJudgingPlan({
      completeness,
      // Unmeasured, so never within the limit: freeze-judging-plan.test.ts has the limit.
      capture:
        completeness === 'complete'
          ? { kind: 'measured', unheardMs: 0, platformLostMs: 0, expectedMs: 1 }
          : { kind: 'platform-unmeasured', expectedMs: 1 },
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
        endsAsPlatformIncident: false,
        dispatchAiJudges: true,
        ballotDeadlineMs: null,
        aiJudgingBudgetMs: 300_000,
      },
      {
        endsAsPlatformIncident: false,
        dispatchAiJudges: false,
        ballotDeadlineMs: 1_800_000,
        aiJudgingBudgetMs: 300_000,
      },
      {
        endsAsPlatformIncident: true,
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
      completeness,
      panel: humanJudges
        ? { humanWindow: window([judges[0]!]), aiSeats: [] }
        : {
            humanWindow: null,
            aiSeats: [standing(judges[0]!, 'not_dispatched')],
          },
      ballots: [],
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
  const noJob = standing(ai, 'not_dispatched');
  const decide = (
    humans: readonly string[],
    ballots: ReturnType<typeof ballot>[],
    aiSeats: JudgingPanel['aiSeats'] = [noJob],
  ) =>
    decidePanelCompletion({
      completeness: 'incomplete',
      panel: { humanWindow: window(humans), aiSeats },
      ballots,
      nowMs: 1_000,
    });
  const window_ = { on: 'human_window', deadlineAt: deadline };
  assert({
    given:
      'a human and an AI judge before the deadline: the human ruled on an incomplete freeze, has not ruled, ruled with the AI seat still running, and two humans split',
    should:
      'complete with the human ruling and the AI seat as no ruling only once every human ruled decisively on an incomplete freeze; a human split ends at once; otherwise keep waiting, and say on what',
    actual: [
      decide([human], [ballot(human, 'negative')]),
      decide([human], []),
      decide([human], [ballot(human, 'negative')], [running(ai)]),
      decide(
        [human, other],
        [ballot(human, 'negative'), ballot(other, 'affirmative')],
      ),
    ],
    expected: [
      {
        kind: 'complete',
        ruling: 'partial',
        outcome: 'negative',
        noRuling: [ai],
      },
      { kind: 'pending', waiting: window_ },
      {
        kind: 'pending',
        waiting: { on: 'ai_generating', deadlineAt: iso(90_000) },
      },
      {
        kind: 'complete',
        ruling: 'judges-split',
        outcome: null,
        noRuling: [ai],
      },
    ],
  });
});

test('the panel decides from each seat: every mode ends, and only a judge who can still rule holds it', () => {
  const [human, ai, other] = judges as [string, string, string];
  const later = 61_000;
  const decide = (input: {
    readonly humans?: readonly string[];
    readonly running?: readonly string[];
    readonly failed?: readonly string[];
    readonly held?: readonly string[];
    readonly noJob?: readonly string[];
    readonly ballots?: ReturnType<typeof ballot>[];
    readonly completeness?: 'complete' | 'incomplete';
    readonly deadline?: number;
  }) =>
    decidePanelCompletion({
      completeness: input.completeness ?? 'complete',
      panel: {
        humanWindow: window(input.humans ?? [], iso(input.deadline ?? later)),
        aiSeats: [
          ...(input.running ?? []).map(running),
          ...(input.failed ?? []).map((id) => standing(id, 'ended')),
          ...(input.held ?? []).map((id) => standing(id, 'holding_ballot')),
          ...(input.noJob ?? []).map((id) => standing(id, 'not_dispatched')),
        ],
      },
      ballots: input.ballots ?? [],
      nowMs: 1_000,
    });
  const summary = (d: ReturnType<typeof decide>) =>
    d.kind === 'pending' ? 'pending' : `${d.ruling}:${d.outcome}`;
  const cases: [string, Parameters<typeof decide>[0], string][] = [
    ['AI-only, job running', { running: [ai] }, 'pending'],
    ['AI-only, holding a ballot', { held: [ai] }, 'pending'],
    [
      'AI-only, job failed: ends at once with no 30 minute wait',
      { failed: [ai] },
      'judging-failed:null',
    ],
    [
      'AI-only, incomplete freeze',
      { noJob: [ai], completeness: 'incomplete' },
      'transcript-incomplete:null',
    ],
    [
      'two AI seats, one failed and one still running',
      { running: [other], failed: [ai] },
      'pending',
    ],
    [
      'two AI seats, one failed and one ruled',
      { noJob: [other], failed: [ai], ballots: [ballot(other, 'negative')] },
      'partial:negative',
    ],
    [
      'mixed, AI failed, human inside the window: the human keeps it',
      { humans: [human], failed: [ai] },
      'pending',
    ],
    [
      'mixed, AI failed, human ruled: no wait for the dead seat',
      {
        humans: [human],
        failed: [ai],
        ballots: [ballot(human, 'affirmative')],
      },
      'partial:affirmative',
    ],
    [
      'mixed, AI failed, human window over with no ballot',
      { humans: [human], failed: [ai], deadline: 1_000 },
      'judges-did-not-rule:null',
    ],
    [
      'mixed, human window over, AI still running',
      { humans: [human], running: [ai], deadline: 1_000 },
      'pending',
    ],
    [
      'a tied panel with nobody left to rule',
      {
        noJob: [ai, other],
        ballots: [ballot(ai, 'negative'), ballot(other, 'affirmative')],
      },
      'judges-split:null',
    ],
    [
      'a tied panel of three with one failed seat',
      {
        noJob: [ai, other],
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

test('a seat with a human judge and no deadline has no panel', () => {
  const facts = {
    completeness: 'complete' as const,
    humanJudgeSeatIds: [judges[0]!],
    aiJudgeSeatIds: [judges[1]!],
    ballotDeadlineAt: null,
    jobs: [],
    held: {
      attendanceCutoffAt: iso(9_000),
      lastAttendanceDecisionAt: null,
      lastWriterResolvedAt: null,
    },
    ballots: [],
  };
  assert({
    given: 'a human judge seat with no persisted deadline',
    should:
      'read no panel, so nothing completes it, as the database guard refuses',
    actual: judgingPanelOf(facts, 1_000),
    expected: null,
  });
  assert({
    given: 'that seat with its deadline, beside an AI seat with no job',
    should: 'read one human window and one undispatched seat',
    actual: judgingPanelOf({ ...facts, ballotDeadlineAt: deadline }, 1_000),
    expected: {
      humanWindow: { deadlineAt: deadline, seatIds: [judges[0]!] },
      aiSeats: [{ id: judges[1]!, standing: { state: 'not_dispatched' } }],
    },
  });
});

test('a tied panel ends one way, however it was reached (ISSUE-996, ISSUE-997)', () => {
  const [human, other, ai] = judges as [string, string, string];
  const split = [ballot(human, 'negative'), ballot(other, 'affirmative')];
  const decide = (aiSeats: JudgingPanel['aiSeats'], nowMs = 1_000) =>
    decidePanelCompletion({
      completeness: 'complete',
      panel: { humanWindow: window([human, other]), aiSeats },
      ballots: split,
      nowMs,
    });
  assert({
    given: 'two humans split inside the window, with no other seat',
    should: 'end at once with no outcome, since nobody can rule again',
    actual: decide([]),
    expected: {
      kind: 'complete',
      ruling: 'judges-split',
      outcome: null,
      noRuling: [],
    },
  });
  assert({
    given: 'that split beside a failed AI seat, inside the window',
    should: 'end at once with no outcome',
    actual: decide([standing(ai, 'ended')]),
    expected: {
      kind: 'complete',
      ruling: 'judges-split',
      outcome: null,
      noRuling: [ai],
    },
  });
  assert({
    given: 'that split beside an AI seat still generating',
    should: 'wait for the seat that can still break it',
    actual: decide([running(ai)]).kind,
    expected: 'pending',
  });
});
