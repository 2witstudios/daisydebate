import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireAgentBallotCapture, requireBallotAdmission } from './admission';
setupRitewayBun();
const judge = 'judgeaaaa1b2c3d4e5f6g7h8';
const roundId = 'roundaaaa1b2c3d4e5f6g7h8';
test('a new ballot needs an undecided Round before its deadline and an unused seat', async () => {
  const admission = {
    round: { status: 'active', outcome: null },
    submittedJudgeIds: ['otherjudge'],
    judgeParticipantId: judge,
    now: '2026-10-22T12:00:00.000Z',
    ballotDeadlineAt: new Date('2026-10-22T12:00:00.001Z'),
  };
  assert({
    given:
      'an active undecided Round before its deadline, and one with no deadline',
    should: 'admit the ballot',
    actual: [
      requireBallotAdmission(admission),
      requireBallotAdmission({ ...admission, ballotDeadlineAt: null }),
    ],
    expected: [undefined, undefined],
  });
  for (const [label, overrides] of [
    ['a completed Round', { round: { status: 'completed', outcome: null } }],
    [
      'a decided Round',
      {
        round: {
          status: 'active',
          outcome: { kind: 'winner', side: 'negative' },
        },
      },
    ],
    [
      'a ballot at its persisted deadline (DEC-207)',
      { ballotDeadlineAt: new Date('2026-10-22T12:00:00.000Z') },
    ],
    ['an already used seat', { submittedJudgeIds: [judge] }],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse the new ballot',
      actual: () => requireBallotAdmission({ ...admission, ...overrides }),
      code: 'CONFLICT',
    });
});

test('an AI judge is refused an incomplete transcript and a human is not (DEC-208)', async () => {
  const agent = {
    kind: 'agent',
    agentRunId: 'run',
    participantId: 'seat',
    serviceId: 'service',
    roundId,
  } as const;
  const human = { kind: 'human', actorId: 'actor' } as const;
  const unmeasured = {
    completeness: 'incomplete',
    unheardMs: null,
    expectedSpeechMs: 0,
  };
  await assertRejects({
    given: 'an agent ballot on an incomplete freeze',
    should: 'refuse it as an invariant',
    actual: async () => requireAgentBallotCapture(agent, unmeasured),
    code: 'INVARIANT',
  });
  await assertRejects({
    given: 'an agent ballot on a freeze whose gap is over the limit',
    should: 'refuse it as an invariant',
    actual: async () =>
      requireAgentBallotCapture(agent, {
        ...unmeasured,
        unheardMs: 10_000,
        expectedSpeechMs: 100_000,
      }),
    code: 'INVARIANT',
  });
  assert({
    given:
      'an agent on a complete freeze, on a small stated gap, and a human on an incomplete one',
    should: 'admit all three',
    actual: [
      requireAgentBallotCapture(agent, {
        ...unmeasured,
        completeness: 'complete',
      }),
      requireAgentBallotCapture(agent, {
        ...unmeasured,
        unheardMs: 1_000,
        expectedSpeechMs: 100_000,
      }),
      requireAgentBallotCapture(human, unmeasured),
    ],
    expected: [undefined, undefined, undefined],
  });
});
