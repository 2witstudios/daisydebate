import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { decideUnjudgedCompletion, freezeJudgingPlan } from './round-unjudged';
import {
  practiceRules,
  practiceSeats,
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
  decideUnjudgedCompletion({
    completeness: 'complete',
    humanJudges: true,
    judgeSeatIds: judges,
    ballots,
    ballotDeadlineAtMs: 61_000,
    nowMs,
  });

test('the ballot deadline decides when a Round without a full ruling completes (DEC-201)', () => {
  assert({
    given: 'no judge seats',
    should: 'complete at once as unjudged',
    actual: decideUnjudgedCompletion({
      completeness: 'complete',
      humanJudges: false,
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

const rules = practiceRules();
const judge = practiceSeats.find((seat) => seat.role === 'judge')!;
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
  competitionType: 'casual' as const,
  now: roundAt(nowMs),
  ballots: [],
  ballotDeadlineAt: roundAt(total + 1_800_000),
  completeness: 'complete' as const,
  humanJudges: true,
});

test('a judged casual Round completes without a winner only after its ballot deadline', async () => {
  const early = judged();
  const before = early.position(roundAt(total + 1_799_999));
  await assertRejects({
    given: 'a judged Round one millisecond before its ballot deadline',
    should: 'refuse and preserve the Round',
    actual: () => early.completeUnjudged(completion(total + 1_799_999)),
    code: 'INVARIANT',
    invariantId: 'round.complete.unjudged-casual-only',
  });
  assert({
    given: 'that refusal',
    should: 'change nothing',
    actual: early.position(roundAt(total + 1_799_999)),
    expected: before,
  });
  const result = judged().completeUnjudged(completion(total + 1_800_000));
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
      { dispatchAiJudges: true, ballotDeadlineMs: 1_800_000 },
      { dispatchAiJudges: false, ballotDeadlineMs: 1_800_000 },
      { dispatchAiJudges: false, ballotDeadlineMs: 0 },
    ],
  });
  const decide = (
    completeness: 'complete' | 'incomplete',
    humanJudges: boolean,
  ) =>
    decideUnjudgedCompletion({
      completeness,
      humanJudges,
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
