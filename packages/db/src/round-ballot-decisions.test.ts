import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  ballotReceipt,
  requireBallotAdmission,
  requireFrozenRevision,
  requireJudgingRun,
} from './round-ballot-decisions';

setupRitewayBun();

const roundId = 'roundaaaa1b2c3d4e5f6g7h8';
const judge = 'judgeaaaa1b2c3d4e5f6g7h8';
const agent = {
  kind: 'agent',
  serviceId: 'agent-run:run',
  agentRunId: 'run',
  roundId,
  participantId: judge,
} as const;
const envelope = { judgeParticipantId: judge, freezeRevision: 2 };
const judging = {
  runKind: 'judging',
  runConfiguration: {
    roundId,
    judgeParticipantId: judge,
    freezeRevision: 2,
    jobEpoch: 1,
  },
};

test('a human ballot needs no judging run', () => {
  assert({
    given: 'a human principal with no run and no lease',
    should: 'leave authority to the human account fence',
    actual: requireJudgingRun(
      {
        roundId,
        principal: { kind: 'human', actorId: 'actor' },
        envelope,
        leased: false,
      },
      { runKind: null, runConfiguration: null },
    ),
    expected: undefined,
  });
});

test('a bot ballot needs a leased judging run for this exact job', async () => {
  const input = { roundId, principal: agent, envelope, leased: true };
  assert({
    given: 'a leased judging run configured for this Round, judge and revision',
    should: 'admit the bot ballot',
    actual: requireJudgingRun(input, judging),
    expected: undefined,
  });
  const config = judging.runConfiguration;
  for (const [label, leased, run] of [
    ['no lease check', false, judging],
    ['a speech run', true, { ...judging, runKind: 'speech' }],
    ['no configuration', true, { ...judging, runConfiguration: null }],
    [
      'another Round',
      true,
      { ...judging, runConfiguration: { ...config, roundId: 'other' } },
    ],
    [
      'another judge',
      true,
      {
        ...judging,
        runConfiguration: { ...config, judgeParticipantId: 'other' },
      },
    ],
    [
      'another revision',
      true,
      { ...judging, runConfiguration: { ...config, freezeRevision: 3 } },
    ],
    [
      'a zero job epoch',
      true,
      { ...judging, runConfiguration: { ...config, jobEpoch: 0 } },
    ],
    [
      'a fractional job epoch',
      true,
      { ...judging, runConfiguration: { ...config, jobEpoch: 1.5 } },
    ],
  ] as const)
    await assertRejects({
      given: `a bot ballot with ${label}`,
      should: 'refuse judging authority',
      actual: () => requireJudgingRun({ ...input, leased }, run),
      code: 'AUTHORIZATION',
    });
});

test('a ballot judges only the frozen revision it names', async () => {
  assert({
    given: 'the named frozen revision',
    should: 'return it',
    actual: requireFrozenRevision({ revision: 2, frontier: 7 }, 2),
    expected: { revision: 2, frontier: 7 },
  });
  for (const frozen of [null, undefined, { revision: 1 }])
    await assertRejects({
      given: `a frozen transcript ${JSON.stringify(frozen)}`,
      should: 'refuse the ballot until the named revision exists',
      actual: () => requireFrozenRevision(frozen, 2),
      code: 'CONFLICT',
    });
});

test('a new ballot needs the expected version, an undecided Round before its deadline and an unused seat', async () => {
  const admission = {
    version: 4,
    expectedVersion: 4,
    round: { status: 'active', outcome: null },
    submittedJudgeIds: ['otherjudge'],
    judgeParticipantId: judge,
    now: '2026-10-22T12:00:00.000Z',
    ballotDeadlineAt: new Date('2026-10-22T12:00:00.001Z'),
  };
  assert({
    given:
      'the expected version on an active undecided Round before its deadline, and one with no deadline',
    should: 'admit the ballot',
    actual: [
      requireBallotAdmission(admission),
      requireBallotAdmission({ ...admission, ballotDeadlineAt: null }),
    ],
    expected: [undefined, undefined],
  });
  for (const [label, overrides] of [
    ['a stale version', { expectedVersion: 3 }],
    ['a completed Round', { round: { status: 'completed', outcome: null } }],
    ['a decided Round', { round: { status: 'active', outcome: 'negative' } }],
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

test('the receipt version advances only when the projection changed the Round', () => {
  const input = {
    commandId: 'command',
    roundId,
    ballotId: 'ballot',
    judgeParticipantId: judge,
    freezeRevision: 2,
    version: 4,
  };
  assert({
    given: 'an unchanged pending Round and a changed decided Round',
    should: 'keep or advance the version and carry the outcome or null',
    actual: [
      ballotReceipt({ ...input, changed: false, outcome: undefined }),
      ballotReceipt({ ...input, changed: true, outcome: 'affirmative' }),
    ].map(({ resultingVersion, outcome }) => ({ resultingVersion, outcome })),
    expected: [
      { resultingVersion: 4, outcome: null },
      { resultingVersion: 5, outcome: 'affirmative' },
    ],
  });
});
