import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { roundWaitingOn } from './round-waiting-on';

setupRitewayBun();

const at = (ms: number) => new Date(ms).toISOString();
const base = {
  nowMs: 1_000,
  finalSegmentEnded: true,
  frozen: true,
  heldByWriter: false,
  attendanceUnresolved: false,
  ballotDeadlineAt: null,
  attendanceCutoffAt: at(9_000),
  humanJudgeUnruled: false,
  jobs: [],
};
const job = (overrides = {}) => ({
  generationDeadlineAt: at(5_000),
  canRule: true,
  holdsBallot: false,
  ...overrides,
});

describe('roundWaitingOn', () => {
  test('names the one thing the Round is waiting on, from server facts', () => {
    const cases: [
      string,
      Partial<Parameters<typeof roundWaitingOn>[0]>,
      ReturnType<typeof roundWaitingOn>,
    ][] = [
      ['speeches still running', { finalSegmentEnded: false }, null],
      [
        'the transcript still closing',
        { frozen: false },
        { state: 'closing_transcript', deadlineAt: null },
      ],
      [
        'an AI job with budget left: no human countdown',
        { jobs: [job()] },
        { state: 'ai_processing', deadlineAt: at(5_000) },
      ],
      [
        'an AI job ended with no ballot',
        { jobs: [job({ canRule: false })] },
        { state: 'ai_failed', deadlineAt: null },
      ],
      [
        'a human inside the window, from the persisted deadline',
        { humanJudgeUnruled: true, ballotDeadlineAt: at(2_000) },
        { state: 'human_window', deadlineAt: at(2_000) },
      ],
      [
        'a failed AI seat beside a human inside the window',
        {
          humanJudgeUnruled: true,
          ballotDeadlineAt: at(2_000),
          jobs: [job({ canRule: false })],
        },
        { state: 'human_window', deadlineAt: at(2_000) },
      ],
      [
        'a human window that has passed',
        { humanJudgeUnruled: true, ballotDeadlineAt: at(500) },
        { state: 'settling', deadlineAt: null },
      ],
      [
        'a validated ballot waiting on attendance',
        {
          attendanceUnresolved: true,
          jobs: [job({ holdsBallot: true })],
        },
        { state: 'awaiting_attendance', deadlineAt: at(9_000) },
      ],
      [
        'a validated ballot still submitting, attendance settled: no false cause',
        { jobs: [job({ holdsBallot: true })] },
        { state: 'settling', deadlineAt: null },
      ],
      [
        'a held ballot past its bound',
        { jobs: [job({ holdsBallot: true, canRule: false })] },
        { state: 'ai_failed', deadlineAt: null },
      ],
      [
        'an uncertain writer: it outranks everything, with no deadline',
        {
          heldByWriter: true,
          attendanceUnresolved: true,
          humanJudgeUnruled: true,
          ballotDeadlineAt: at(2_000),
        },
        { state: 'held_by_writer', deadlineAt: null },
      ],
    ];
    for (const [given, overrides, expected] of cases)
      assert({
        given,
        should: `be ${expected?.state ?? 'null'}`,
        actual: roundWaitingOn({ ...base, ...overrides }),
        expected,
      });
  });
});
