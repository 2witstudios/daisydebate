import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { JudgingPanelFacts } from '@daisy/protocol';
import type { attendanceSettled } from './attendance-order';
import { roundWaitingOn } from './round-waiting-on';

setupRitewayBun();

const at = (ms: number) => new Date(ms).toISOString();
const [human, other, ai] = ['h'.repeat(24), 'o'.repeat(24), 'a'.repeat(24)] as [
  string,
  string,
  string,
];
const frozen = (
  overrides: Partial<JudgingPanelFacts> = {},
): JudgingPanelFacts => ({
  completeness: 'complete',
  humanJudgeSeatIds: [],
  aiJudgeSeatIds: [],
  ballotDeadlineAt: null,
  jobs: [],
  held: {
    attendanceCutoffAt: at(9_000),
    lastAttendanceDecisionAt: null,
    lastWriterResolvedAt: null,
  },
  ballots: [],
  ...overrides,
});
const job = (overrides = {}) => ({
  judgeParticipantId: ai,
  status: 'leased' as const,
  generationDeadlineAt: at(5_000),
  holdsBallot: false,
  ...overrides,
});
const aiFacts = (overrides = {}) =>
  frozen({ aiJudgeSeatIds: [ai], jobs: [job(overrides)] });
const humanFacts = (deadline: number, overrides = {}) =>
  frozen({
    humanJudgeSeatIds: [human],
    ballotDeadlineAt: at(deadline),
    ...overrides,
  });
const noSpeeches = {
  ruleSegments: [],
  speeches: [],
  adjudications: [],
  receipts: [],
  pendingWriter: false,
};
/** A played speech with no decision: attendance is not settled. */
const unsettled = {
  ...noSpeeches,
  speeches: [{ id: 's', rulesSegmentKey: 'AC', startedAt: at(0) }],
};
const ended = (
  facts: JudgingPanelFacts | null,
  attendance: Parameters<typeof attendanceSettled>[0] = noSpeeches,
) => ({
  speeches: 'ended' as const,
  nowMs: 1_000,
  attendance,
  frozen: facts,
});

describe('roundWaitingOn', () => {
  test('names the one thing the Round is waiting on, from server facts', () => {
    const cases: [
      string,
      Parameters<typeof roundWaitingOn>[0],
      ReturnType<typeof roundWaitingOn>,
    ][] = [
      ['speeches still running', { speeches: 'running' }, null],
      [
        'the transcript still closing',
        ended(null),
        { state: 'closing_transcript' },
      ],
      [
        'an AI job with budget left: no human countdown',
        ended(aiFacts()),
        { state: 'ai_processing', deadlineAt: at(5_000) },
      ],
      [
        'an AI job ended with no ballot',
        ended(aiFacts({ status: 'failed' })),
        { state: 'ai_failed' },
      ],
      [
        'a human inside the window, from the persisted deadline',
        ended(humanFacts(2_000)),
        { state: 'human_window', deadlineAt: at(2_000) },
      ],
      [
        'a failed AI seat beside a human inside the window',
        ended(
          humanFacts(2_000, {
            aiJudgeSeatIds: [ai],
            jobs: [job({ status: 'failed' })],
          }),
        ),
        { state: 'human_window', deadlineAt: at(2_000) },
      ],
      [
        'a human window that has passed',
        ended(humanFacts(500)),
        { state: 'settling' },
      ],
      [
        'a validated ballot waiting on attendance',
        ended(aiFacts({ holdsBallot: true }), unsettled),
        { state: 'awaiting_attendance', deadlineAt: at(9_000) },
      ],
      [
        'a validated ballot still submitting, attendance settled: no false cause',
        ended(aiFacts({ holdsBallot: true })),
        { state: 'settling' },
      ],
      [
        'a held ballot beyond its old expiry still submitting',
        ended(
          frozen({
            aiJudgeSeatIds: [ai],
            jobs: [job({ holdsBallot: true, generationDeadlineAt: at(500) })],
            held: {
              attendanceCutoffAt: at(900),
              lastAttendanceDecisionAt: null,
              lastWriterResolvedAt: null,
            },
          }),
        ),
        { state: 'settling' },
      ],
      [
        'a human seat with no persisted deadline: no invented window',
        ended(frozen({ humanJudgeSeatIds: [human] })),
        { state: 'settling' },
      ],
      [
        'an uncertain writer: it outranks everything, with no deadline',
        ended(humanFacts(2_000), { ...unsettled, pendingWriter: true }),
        { state: 'held_by_writer' },
      ],
    ];
    for (const [given, facts, expected] of cases)
      assert({
        given,
        should: `be ${expected?.state ?? 'null'}`,
        actual: roundWaitingOn(facts),
        expected,
      });
  });

  test('a tied panel reads what the panel decision says (ISSUE-997)', () => {
    const split = humanFacts(2_000, {
      humanJudgeSeatIds: [human, other],
      aiJudgeSeatIds: [ai],
      jobs: [job({ status: 'failed' })],
      ballots: [
        { judgeParticipantId: human, winner: 'affirmative' },
        { judgeParticipantId: other, winner: 'negative' },
      ],
    });
    assert({
      given: 'human judges split and a failed AI seat with the window open',
      should: 'show no clock: nobody can still rule, so the Round is ending',
      actual: roundWaitingOn(ended(split)),
      expected: { state: 'ai_failed' },
    });
  });
});

test('every reason a panel is pending has its own reading (no fall-through)', () => {
  const recovering = aiFacts({ status: 'recovering' });
  const blocked = aiFacts({ status: 'blocked' });
  const holding = aiFacts({ holdsBallot: true });
  assert({
    given:
      'each pending panel wait: a human window, generating, recovering, blocked, and a held ballot with attendance open then settled',
    should:
      'name each one, the held ballot by what attendance still owes and never by an AI job state',
    actual: [
      roundWaitingOn(ended(humanFacts(2_000)))?.state,
      roundWaitingOn(ended(aiFacts()))?.state,
      roundWaitingOn(ended(recovering))?.state,
      roundWaitingOn(ended(blocked))?.state,
      roundWaitingOn(ended(holding, unsettled))?.state,
      roundWaitingOn(ended(holding))?.state,
      // Recovering work outranks open attendance, as it did before.
      roundWaitingOn(ended(recovering, unsettled))?.state,
    ],
    expected: [
      'human_window',
      'ai_processing',
      'ai_recovering',
      'ai_blocked',
      'awaiting_attendance',
      'settling',
      'ai_recovering',
    ],
  });
});
