import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  firstPassLost,
  judgingProgress,
  pendingBallotAction,
  requireClaimableJob,
  requireCurrentJob,
  requireCurrentRun,
  requireJudgingService,
  requireLiveJudgingLease,
  requireNextStage,
  requireUndispatched,
} from './round-judging-decisions';

setupRitewayBun();

const now = new Date('2026-10-22T12:00:00.000Z');
const later = new Date('2026-10-22T12:00:30.000Z');
const scope = {
  roundId: 'round',
  judgeParticipantId: 'judge',
  freezeRevision: 2,
  agentRunId: 'run',
  commandId: 'command',
  serviceId: 'agent-run:run',
  jobEpoch: 3,
};
type Job = NonNullable<Parameters<typeof requireCurrentJob>[0]>;
type Run = NonNullable<Parameters<typeof requireCurrentRun>[0]>;
const job = (overrides: Record<string, unknown> = {}) =>
  ({
    status: 'leased',
    attempts: 3,
    freezeRevision: 2,
    commandId: 'command',
    leaseExpiresAt: later,
    pendingBallot: null,
    ...overrides,
  }) as unknown as Job;
const run = (overrides: Record<string, unknown> = {}, config = {}) =>
  ({
    endedAt: null,
    kind: 'judging',
    configurationSnapshot: {
      roundId: 'round',
      judgeParticipantId: 'judge',
      freezeRevision: 2,
      jobEpoch: 3,
      ...config,
    },
    ...overrides,
  }) as unknown as Run;

test('a judging job is claimable when queued or expired and not bound elsewhere', async () => {
  assert({
    given:
      'a queued unbound job, an expired lease and a job bound to this command',
    should: 'admit each claim',
    actual: [
      requireClaimableJob(
        job({ status: 'queued', commandId: null, leaseExpiresAt: null }),
        'command',
        now,
      ),
      requireClaimableJob(job({ leaseExpiresAt: now }), 'command', now),
      requireClaimableJob(job({ leaseExpiresAt: null }), 'command', now),
    ],
    expected: [undefined, undefined, undefined],
  });
  for (const [label, candidate] of [
    ['no job', undefined],
    [
      'a job bound to another command',
      job({ leaseExpiresAt: null, commandId: 'other' }),
    ],
    ['a live lease', job()],
    [
      'a queued retry before its due time',
      job({ status: 'queued', leaseExpiresAt: null, retryAt: later }),
    ],
    ['a succeeded job', job({ status: 'succeeded', leaseExpiresAt: null })],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse the claim',
      actual: () => requireClaimableJob(candidate, 'command', now),
      code: 'CONFLICT',
    });
});

test('a judging lease belongs to one run, epoch, revision and command', async () => {
  assert({
    given: 'the current lease, its own service and a live expiry',
    should: 'admit it',
    actual: [
      requireJudgingService(scope),
      requireCurrentJob(job(), scope),
      requireLiveJudgingLease(job(), now),
    ],
    expected: [undefined, undefined, undefined],
  });
  await assertRejects({
    given: 'a service that is not the scope’s own run',
    should: 'refuse authority',
    actual: () =>
      requireJudgingService({ ...scope, serviceId: 'agent-run:other' }),
    code: 'AUTHORIZATION',
  });
  for (const [label, candidate] of [
    ['no job', undefined],
    ['a queued job', job({ status: 'queued' })],
    ['a newer epoch', job({ attempts: 4 })],
    ['another revision', job({ freezeRevision: 1 })],
    ['another command', job({ commandId: 'other' })],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse the changed lease',
      actual: () => requireCurrentJob(candidate, scope),
      code: 'CONFLICT',
    });
  for (const leaseExpiresAt of [now, null])
    await assertRejects({
      given: `a lease expiring at ${leaseExpiresAt}`,
      should: 'refuse it as expired at the sampled time',
      actual: () => requireLiveJudgingLease(job({ leaseExpiresAt }), now),
      code: 'CONFLICT',
    });
});

test('the run is the live judging run configured for this job', async () => {
  assert({
    given: 'the configured live judging run',
    should: 'admit it',
    actual: requireCurrentRun(run(), scope),
    expected: undefined,
  });
  for (const [label, candidate] of [
    ['no run', undefined],
    ['an ended run', run({ endedAt: now })],
    ['a speech run', run({ kind: 'speech' })],
    ['another Round', run({}, { roundId: 'other' })],
    ['another judge', run({}, { judgeParticipantId: 'other' })],
    ['another revision', run({}, { freezeRevision: 1 })],
    ['another epoch', run({}, { jobEpoch: 2 })],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse judging authority',
      actual: () => requireCurrentRun(candidate, scope),
      code: 'AUTHORIZATION',
    });
});

test('each attempt dispatches the provider at most once', async () => {
  assert({
    given: 'an attempt that has not dispatched',
    should: 'admit the dispatch',
    actual: requireUndispatched(job(), undefined),
    expected: undefined,
  });
  for (const [label, candidateJob, candidateRun] of [
    [
      'a held response',
      job({ pendingBallot: { winner: 'affirmative' } }),
      undefined,
    ],
    ['a recorded dispatch', job(), { outcome: 'dispatched' }],
    ['a settled dispatch', job(), { outcome: 'failed' }],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse a second dispatch',
      actual: () => requireUndispatched(candidateJob, candidateRun),
      code: 'CONFLICT',
    });
});

test('the first accounted response is kept and a different one refused', async () => {
  const ballot = { winner: 'affirmative', scores: { a: 1 } };
  const received = { answeredAt: new Date(0) };
  assert({
    given: 'an accounted response, then an identical retry',
    should: 'store the first and keep it for the retry',
    actual: [
      pendingBallotAction(job(), received, ballot),
      pendingBallotAction(
        job({ pendingBallot: ballot }),
        received,
        structuredClone(ballot),
      ),
    ],
    expected: ['store', 'kept'],
  });
  for (const [label, candidateJob, candidateRun] of [
    [
      'a different response after one was kept',
      job({ pendingBallot: { ...ballot, winner: 'negative' } }),
      received,
    ],
    ['a response whose usage was not accounted', job(), { answeredAt: null }],
    ['a response with no dispatch', job(), undefined],
  ] as const)
    await assertRejects({
      given: label,
      should: 'refuse the response',
      actual: () => pendingBallotAction(candidateJob, candidateRun, ballot),
      code: 'CONFLICT',
    });
});

test('a job needs one coherency stage at a time, and the final one reads the map (ADR 0125)', async () => {
  const caseMap = { about: 'transit' };
  const ballot = { winner: 'affirmative' };
  const stages = (overrides: Record<string, unknown>) =>
    ({
      pendingBallot: null,
      firstBallot: null,
      firstBallotFailed: false,
      caseMap: null,
      ...overrides,
    }) as unknown as Parameters<typeof judgingProgress>[0];
  assert({
    given:
      'a new job, a stored or failed first pass, a stored map, and a held ballot',
    should:
      'need the first pass, then the map, then the final ballot with that map, then nothing',
    actual: [
      judgingProgress(stages({})),
      judgingProgress(stages({ firstBallot: ballot })),
      judgingProgress(stages({ firstBallotFailed: true })),
      judgingProgress(stages({ firstBallotFailed: true, caseMap })),
      judgingProgress(stages({ caseMap, pendingBallot: ballot })),
    ],
    expected: [
      { kind: 'stage_due', due: { stage: 'first' } },
      { kind: 'stage_due', due: { stage: 'map' } },
      { kind: 'stage_due', due: { stage: 'map' } },
      { kind: 'stage_due', due: { stage: 'final', caseMap } },
      { kind: 'ballot_held', ballot },
    ],
  });
  for (const [label, candidate, stage] of [
    ['a new job', stages({}), 'map'],
    ['a stored map', stages({ firstBallotFailed: true, caseMap }), 'map'],
    ['a held ballot', stages({ caseMap, pendingBallot: ballot }), 'final'],
  ] as const)
    await assertRejects({
      given: label,
      should: `refuse to buy the ${stage} stage`,
      actual: () => requireNextStage(candidate, stage),
      code: 'CONFLICT',
    });
});

test('a first pass lost with its run is its one try', () => {
  const fresh = { firstBallot: null, firstBallotFailed: false } as const;
  assert({
    given:
      'a takeover finding a prior first-pass call still dispatched, failed, or absent, or a first pass already settled',
    should: 'count only the lost, unsettled call as the spent try',
    actual: [
      firstPassLost(fresh, { outcome: 'dispatched' }),
      firstPassLost(fresh, { outcome: 'failed' }),
      firstPassLost(fresh, undefined),
      firstPassLost(
        { firstBallot: null, firstBallotFailed: true },
        { outcome: 'dispatched' },
      ),
    ],
    expected: [true, false, false, false],
  });
});
