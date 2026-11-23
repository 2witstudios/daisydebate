import { virtualClock } from '@daisy/clock/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  capacityRefusalDetail,
  withLaneOperation,
  createLaneGate,
  profileConnections,
  validateWorkloadProfile,
  WORKLOAD_PROFILES,
} from './workload';
import { RUNTIME_SESSION } from './session-bounds';

setupRitewayBun();

const settled = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const reasonOf = (error: unknown) => {
  const detail = capacityRefusalDetail(error);
  return detail && { lane: detail.lane, reason: detail.reason };
};

test('a lane refuses beyond its counted queue and reports why', async () => {
  const clock = virtualClock();
  const gate = createLaneGate(
    'social',
    { connections: 1, queue: 1, maxWaitMs: 100 },
    clock,
  );
  await gate.admit();
  const queued = settled(gate.admit());
  const refused = await settled(gate.admit());
  assert({
    given: 'one running and one queued on a one-connection, one-waiter lane',
    should: 'refuse the next at once as saturated on that lane',
    actual: [
      refused.ok,
      refused.ok ? undefined : reasonOf(refused.error),
      gate.stats(),
    ],
    expected: [
      false,
      { lane: 'social', reason: 'saturated' },
      { active: 1, waiting: 1 },
    ],
  });
  void queued;
});

test('a refusal names what holds the lane, by the operation that asked (ISSUE-1110)', async () => {
  const clock = virtualClock();
  const gate = createLaneGate(
    'competitive',
    { connections: 3, queue: 1, maxWaitMs: 100 },
    clock,
  );
  const leaveTick = await withLaneOperation('executeRoundTick', () =>
    gate.admit(2),
  );
  await withLaneOperation('readLaunchedRound', () => gate.admit());
  // Granted when the tick leaves, from the tick's own call: it still counts as a read.
  const queued = withLaneOperation('getRound', () => gate.admit(2));
  const refused = await settled(gate.admit());
  leaveTick();
  await queued;
  void settled(gate.admit()); // Fills the one waiter's place.
  const later = await settled(gate.admit());
  const holders = (outcome: Awaited<ReturnType<typeof settled>>) =>
    outcome.ok ? undefined : capacityRefusalDetail(outcome.error)?.holders;
  assert({
    given: 'holds taken under named operations, and work with no operation',
    should: 'count connections per operation, each under the one that asked',
    actual: [holders(refused), holders(later)],
    expected: [
      { executeRoundTick: 2, readLaunchedRound: 1 },
      { getRound: 2, readLaunchedRound: 1 },
    ],
  });
});

test('work under no operation is named as such, not dropped', async () => {
  const clock = virtualClock();
  const gate = createLaneGate(
    'competitive',
    { connections: 1, queue: 0, maxWaitMs: 100 },
    clock,
  );
  await gate.admit();
  const refused = await settled(gate.admit());
  assert({
    given: 'a hold no operation wrapped',
    should: 'count it as unlabelled, so the gap in coverage shows',
    actual: refused.ok
      ? undefined
      : capacityRefusalDetail(refused.error)?.holders,
    expected: { unlabelled: 1 },
  });
});

test('a waiter older than the lane age is refused and leaves the queue', async () => {
  const clock = virtualClock();
  const gate = createLaneGate(
    'competitive',
    { connections: 1, queue: 4, maxWaitMs: 1000 },
    clock,
  );
  const release = await gate.admit();
  const waiting = settled(gate.admit());
  await clock.advance(999);
  const before = gate.stats();
  await clock.advance(1);
  const outcome = await waiting;
  release();
  assert({
    given: 'a waiter still queued when the competitive lane age passes',
    should:
      'keep it queued until the age passes, then refuse it as expired, unrun, and free the lane for later work',
    actual: [
      before,
      outcome.ok ? undefined : reasonOf(outcome.error),
      gate.stats(),
    ],
    expected: [
      { active: 1, waiting: 1 },
      { lane: 'competitive', reason: 'expired' },
      { active: 0, waiting: 0 },
    ],
  });
});

test('waiters take turns across fairness keys, FIFO within one', async () => {
  const clock = virtualClock();
  const gate = createLaneGate(
    'social',
    { connections: 1, queue: 8, maxWaitMs: 1000 },
    clock,
  );
  const order: string[] = [];
  const first = await gate.admit(1, 'a');
  const waiters = [
    ['a', 'a1'],
    ['a', 'a2'],
    ['a', 'a3'],
    ['b', 'b1'],
  ].map(([key, label]) =>
    gate.admit(1, key).then((release) => {
      order.push(label!);
      queueMicrotask(release);
    }),
  );
  first();
  await Promise.all(waiters);
  assert({
    given: 'three queued requests from one network and one from another',
    should: 'serve the second network before the first one’s backlog',
    actual: order,
    expected: ['a1', 'b1', 'a2', 'a3'],
  });
});

test('a two-connection writer holds its turn instead of being starved', async () => {
  const clock = virtualClock();
  const gate = createLaneGate(
    'competitive',
    { connections: 2, queue: 8, maxWaitMs: 1000 },
    clock,
  );
  const order: string[] = [];
  const reader = await gate.admit(1);
  const writer = gate.admit(2).then((release) => {
    order.push('writer');
    return release;
  });
  const later = gate.admit(1).then((release) => {
    order.push('reader');
    return release;
  });
  await tick();
  const before = [...order];
  reader();
  (await writer)();
  (await later)();
  assert({
    given: 'a running reader, then a queued writer and a queued reader',
    should:
      'not let the later reader take the free connection ahead of the writer',
    actual: { before, after: order },
    expected: { before: [], after: ['writer', 'reader'] },
  });
});

test('release is idempotent and an unconfigured lane refuses everything', async () => {
  const gate = createLaneGate(
    'social',
    { connections: 1, queue: 0, maxWaitMs: 10 },
    virtualClock(),
  );
  const release = await gate.admit();
  release();
  release();
  const absent = await settled(
    createLaneGate('headers', undefined, virtualClock()).admit(),
  );
  assert({
    given: 'a double release, then a lane the profile does not configure',
    should: 'count the connection back once, and refuse as unconfigured',
    actual: [gate.stats(), absent.ok ? undefined : reasonOf(absent.error)],
    expected: [
      { active: 0, waiting: 0 },
      { lane: 'headers', reason: 'unconfigured' },
    ],
  });
});

test('the deployed profiles are valid and sized as the plan states', () => {
  assert({
    given: 'the web, realtime and observer profiles',
    should:
      'validate and hold 34, 7 and 11 connections, dedicated ones included',
    actual: [
      WORKLOAD_PROFILES.web,
      WORKLOAD_PROFILES.realtime,
      WORKLOAD_PROFILES['realtime-observer'],
    ].map((profile) => profileConnections(validateWorkloadProfile(profile))),
    expected: [34, 7, 11],
  });
});

test('a full audience lane refuses at once and queues no viewer', async () => {
  const gate = createLaneGate(
    'audience',
    WORKLOAD_PROFILES.web.lanes.audience,
    virtualClock(),
  );
  const held = [await gate.admit(), await gate.admit()];
  const refused = await gate.admit().catch((error: unknown) => error);
  assert({
    given: 'the audience lane with every connection taken',
    should: 'refuse the next read as saturated with nobody waiting',
    actual: [capacityRefusalDetail(refused)?.reason, gate.stats().waiting],
    expected: ['saturated', 0],
  });
  held.forEach((release) => release());
  (await gate.admit())();
});

test('a queued subscribe outlasts one read blocked on a fence (ISSUE-914)', () => {
  const { realtime, 'realtime-observer': observer } = WORKLOAD_PROFILES;
  assert({
    given: 'every realtime profile and the session lock bound',
    should: 'let an admission waiter outlast one read holding the connection',
    actual: [realtime, observer].map(
      ({ lanes }) => lanes.admission.maxWaitMs > RUNTIME_SESSION.lock_timeout,
    ),
    expected: [true, true],
  });
});

test('a refusal says what the lane was waiting on', async () => {
  const clock = virtualClock();
  const gate = createLaneGate(
    'admission',
    { connections: 1, queue: 8, maxWaitMs: 100 },
    clock,
  );
  await gate.admit();
  await clock.advance(300);
  const expiring = settled(gate.admit());
  await clock.advance(50);
  const queued = settled(gate.admit());
  await clock.advance(50);
  const outcome = await expiring;
  assert({
    given: 'one hold of 400 ms, a waiter expiring and another still queued',
    should: 'report the waiters left, the running work and its age',
    actual: outcome.ok ? undefined : capacityRefusalDetail(outcome.error),
    expected: {
      lane: 'admission',
      reason: 'expired',
      pressure: { pending: 1, running: 1, oldestAgeMs: 400 },
      holders: { unlabelled: 1 },
    },
  });
  void queued;
});

test('a lane reports how long each operation held its connections', async () => {
  const clock = virtualClock();
  const gate = createLaneGate(
    'competitive',
    { connections: 2, queue: 0, maxWaitMs: 100 },
    clock,
  );
  const release = await withLaneOperation('claimMediaReconcile', () =>
    gate.admit(),
  );
  await clock.advance(30);
  release();
  release();
  assert({
    given: 'one hold of 30 ms released twice',
    should: 'count it once under the operation that asked',
    actual: gate.drainHolds().operations,
    expected: [
      {
        operation: 'claimMediaReconcile',
        count: 1,
        totalMs: 30,
        maxMs: 30,
        p95Ms: 30,
        waits: 0,
      },
    ],
  });
});

test('a lane counts the holds that queued before their grant', async () => {
  const clock = virtualClock();
  const gate = createLaneGate(
    'competitive',
    { connections: 1, queue: 4, maxWaitMs: 1000 },
    clock,
  );
  const first = await withLaneOperation('scanRoundJudgingJobs', () =>
    gate.admit(),
  );
  const queued = withLaneOperation('claimRoundJudgingJob', () => gate.admit());
  await clock.advance(5);
  first();
  (await queued)();
  const { total, operations } = gate.drainHolds();
  assert({
    given: 'a second operation queued behind the only connection',
    should: 'count one wait, on that operation and on the lane',
    actual: {
      lane: total.waits,
      byOperation: operations.map(({ operation, waits }) => [operation, waits]),
    },
    expected: {
      lane: 1,
      byOperation: [
        ['scanRoundJudgingJobs', 0],
        ['claimRoundJudgingJob', 1],
      ],
    },
  });
});
