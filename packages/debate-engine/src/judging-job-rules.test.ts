import { judgingPolicy } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  aiSeatStanding,
  generationBudgetSpent,
  heldBallotHoldEndsAtMs,
  judgingDispatchEnd,
  judgingEndIsReported,
  judgingJobEndReason,
} from './judging-job-rules';

setupRitewayBun();
const at = (ms: number) => new Date(ms).toISOString();
const job = (overrides = {}) => ({
  status: 'leased' as const,
  generationDeadlineAt: at(5_000),
  holdsBallot: false,
  ...overrides,
});
const held = {
  attendanceCutoffAt: at(9_000),
  lastAttendanceDecisionAt: null,
  lastWriterResolvedAt: null,
};
const grace = judgingPolicy.heldBallotGraceMs;

test('what an AI seat can still do', () => {
  const cases = [
    [
      'budget left and no ballot',
      job(),
      1_000,
      { state: 'generating', deadlineAt: at(5_000) },
    ],
    ['the budget just spent', job(), 5_000, { state: 'ended' }],
    [
      'budget left and a held ballot',
      job({ holdsBallot: true }),
      1_000,
      { state: 'holding_ballot' },
    ],
    [
      'a held ballot past the budget, before the cutoff',
      job({ holdsBallot: true }),
      8_999,
      { state: 'holding_ballot' },
    ],
    [
      'a held ballot at the cutoff',
      job({ holdsBallot: true }),
      9_000,
      { state: 'ended' },
    ],
    ['a failed job', job({ status: 'failed' }), 1_000, { state: 'ended' }],
    [
      'a succeeded job',
      job({ status: 'succeeded' }),
      1_000,
      { state: 'succeeded' },
    ],
  ] as const;
  for (const [given, facts, nowMs, expected] of cases)
    assert({
      given,
      should: `read ${expected.state}`,
      actual: aiSeatStanding(facts, held, nowMs),
      expected,
    });
});

test('how long a held ballot may hold its Round', () => {
  assert({
    given: 'no attendance decision and no writer',
    should: 'end at the cutoff',
    actual: heldBallotHoldEndsAtMs(held),
    expected: 9_000,
  });
  assert({
    given: 'a decision after the cutoff',
    should: 'end a grace after that decision',
    actual: heldBallotHoldEndsAtMs({
      ...held,
      lastAttendanceDecisionAt: at(20_000),
    }),
    expected: 20_000 + grace,
  });
  assert({
    given: 'a writer resolving last',
    should: 'end a grace after it resolved',
    actual: heldBallotHoldEndsAtMs({
      ...held,
      lastAttendanceDecisionAt: at(20_000),
      lastWriterResolvedAt: at(30_000),
    }),
    expected: 30_000 + grace,
  });
});

test('when a job buys nothing more', () => {
  const deadline = { generationDeadlineAt: at(5_000) };
  assert({
    given: 'its paid calls bought',
    should: 'be exhausted, even with budget left',
    actual: judgingDispatchEnd(
      { ...deadline, paidCalls: judgingPolicy.maxPaidCalls },
      1_000,
    ),
    expected: 'attempts_exhausted',
  });
  assert({
    given: 'its budget passed',
    should: 'end on the deadline',
    actual: judgingDispatchEnd({ ...deadline, paidCalls: 0 }, 5_000),
    expected: 'generation_deadline',
  });
  assert({
    given: 'calls and budget left',
    should: 'not end',
    actual: judgingDispatchEnd({ ...deadline, paidCalls: 1 }, 4_999),
    expected: null,
  });
  assert({
    given: 'a held ballot past the budget',
    should: 'not count the budget as spent',
    actual: generationBudgetSpent(job({ holdsBallot: true }), 6_000),
    expected: false,
  });
  assert({
    given: 'no ballot past the budget',
    should: 'count the budget as spent',
    actual: generationBudgetSpent(job(), 5_000),
    expected: true,
  });
});

test('judging names why a Round’s end ended a job', () => {
  const holding = job({ holdsBallot: true });
  const cases = [
    ['a forfeit cutting off a held ballot', holding, 'forfeit', 'round_ended'],
    [
      'an abandonment with a held ballot',
      holding,
      'abandoned',
      'ballot_hold_ended',
    ],
    [
      'a panel closing without a held ballot',
      holding,
      'panel_closed',
      'ballot_hold_ended',
    ],
  ] as const;
  for (const [given, facts, ending, expected] of cases)
    assert({
      given,
      should: `end it ${expected}`,
      actual: judgingJobEndReason(facts, ending, 1_000),
      expected,
    });
  assert({
    given: 'no ballot and budget left',
    should: 'say the Round ended it',
    actual: judgingJobEndReason(job(), 'abandoned', 1_000),
    expected: 'round_ended',
  });
  assert({
    given: 'no ballot and the budget gone',
    should: 'say the budget ended it',
    actual: judgingJobEndReason(job(), 'forfeit', 5_000),
    expected: 'generation_deadline',
  });
  assert({
    given: 'each reason',
    should: 'report all but the Round’s own end',
    actual: (
      ['round_ended', 'ballot_hold_ended', 'generation_deadline'] as const
    ).map(judgingEndIsReported),
    expected: [false, true, true],
  });
});
