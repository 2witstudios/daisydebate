import { assert, setupRitewayBun, test } from 'riteway/bun';
import { capacityRefusalDetail } from './capacity-refusal';
import {
  createLaneGate,
  profileConnections,
  validateWorkloadProfile,
  WORKLOAD_PROFILES,
  type LaneTimer,
} from './workload-admission';

setupRitewayBun();

/** A manual timer: `advance(ms)` fires every due callback in order. */
function manualTimer() {
  let now = 0;
  let due: { at: number; fire: () => void; live: boolean }[] = [];
  const timer: LaneTimer = (ms, fire) => {
    const entry = { at: now + ms, fire, live: true };
    due.push(entry);
    return () => {
      entry.live = false;
    };
  };
  return {
    timer,
    advance(ms: number) {
      now += ms;
      const firing = due.filter((entry) => entry.live && entry.at <= now);
      due = due.filter((entry) => !firing.includes(entry));
      for (const entry of firing) entry.fire();
    },
  };
}
const settled = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a lane refuses beyond its counted queue and reports why', async () => {
  const { timer } = manualTimer();
  const gate = createLaneGate(
    'social',
    { connections: 1, queue: 1, maxWaitMs: 100 },
    timer,
  );
  await gate.admit();
  const queued = settled(gate.admit());
  const refused = await settled(gate.admit());
  assert({
    given: 'one running and one queued on a one-connection, one-waiter lane',
    should: 'refuse the next at once as saturated on that lane',
    actual: [
      refused.ok,
      refused.ok ? undefined : capacityRefusalDetail(refused.error),
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

test('a waiter older than the lane age is refused and leaves the queue', async () => {
  const clock = manualTimer();
  const gate = createLaneGate(
    'competitive',
    { connections: 1, queue: 4, maxWaitMs: 1000 },
    clock.timer,
  );
  const release = await gate.admit();
  const waiting = settled(gate.admit());
  clock.advance(1000);
  const outcome = await waiting;
  release();
  assert({
    given: 'a waiter still queued when the competitive lane age passes',
    should: 'refuse it as expired, unrun, and free the lane for later work',
    actual: [
      outcome.ok ? undefined : capacityRefusalDetail(outcome.error),
      gate.stats(),
    ],
    expected: [
      { lane: 'competitive', reason: 'expired' },
      { active: 0, waiting: 0 },
    ],
  });
});

test('waiters take turns across fairness keys, FIFO within one', async () => {
  const { timer } = manualTimer();
  const gate = createLaneGate(
    'social',
    { connections: 1, queue: 8, maxWaitMs: 1000 },
    timer,
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
  const { timer } = manualTimer();
  const gate = createLaneGate(
    'competitive',
    { connections: 2, queue: 8, maxWaitMs: 1000 },
    timer,
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
  const gate = createLaneGate('social', {
    connections: 1,
    queue: 0,
    maxWaitMs: 10,
  });
  const release = await gate.admit();
  release();
  release();
  const absent = await settled(createLaneGate('headers', undefined).admit());
  assert({
    given: 'a double release, then a lane the profile does not configure',
    should: 'count the connection back once, and refuse as unconfigured',
    actual: [
      gate.stats(),
      absent.ok ? undefined : capacityRefusalDetail(absent.error),
    ],
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
      'validate and hold 18, 7 and 11 connections, dedicated ones included',
    actual: [
      WORKLOAD_PROFILES.web,
      WORKLOAD_PROFILES.realtime,
      WORKLOAD_PROFILES['realtime-observer'],
    ].map((profile) => profileConnections(validateWorkloadProfile(profile))),
    expected: [18, 7, 11],
  });
});
