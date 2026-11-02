import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundMediaState } from '@daisy/protocol';
import { settle } from './browser-transport.test-support';
import {
  createMediaController,
  type BrowserMediaTransport,
  type MediaConnectionState,
} from './media-controller';
import {
  admission,
  fakeBudget,
  roundId,
  snapshot,
  transportStub,
} from './media-controller.test-support';
import {
  failureKind,
  mediaFailure,
  transientMediaFailure,
} from './media-failure';
import { createMediaRecovery, decideMediaRecovery } from './media-recovery';
import { mediaStatus } from './media-status';
import { MEDIA_RETRY_DELAYS_MS } from './request-media';

setupRitewayBun();

const delaysMs = [1_000, 2_000, 4_000];

/** The session's wiring, with its timers in the test's hands. */
const recovering = (input: {
  readonly admit?: (signal: AbortSignal) => Promise<unknown>;
  readonly reconcile?: (signal: AbortSignal) => Promise<unknown>;
  readonly transport?: () => BrowserMediaTransport;
  readonly readBudget?: Parameters<
    typeof createMediaController
  >[0]['readBudget'];
}) => {
  const timers: { readonly ms: number; readonly fire: () => void }[] = [];
  const seen: MediaConnectionState[] = [];
  let refreshes = 0;
  let nowMs = 100_000;
  const recovery = createMediaRecovery({
    delaysMs,
    eventFloorMs: 5_000,
    now: () => nowMs,
    schedule: (fire, ms) => {
      const timer = { ms, fire };
      timers.push(timer);
      return () => void timers.splice(timers.indexOf(timer), 1);
    },
    rejoin: () => void controller.reconnect(),
    wake: () => void controller.reconcile({ kind: 'wake' }),
    refresh: () => void refreshes++,
  });
  const controller = createMediaController({
    roundId,
    initialRoundViewVersion: 1,
    api: {
      admit: (_id, signal) =>
        input.admit?.(signal) ?? Promise.resolve(admission),
      reconcile: (_id, signal) =>
        input.reconcile?.(signal) ?? Promise.resolve(snapshot),
    },
    transport: input.transport ?? transportStub,
    changed: (state, failure) => {
      seen.push(state);
      recovery.changed(state, failure);
    },
    retry: { delaysMs: MEDIA_RETRY_DELAYS_MS, wait: async () => undefined },
    ...(input.readBudget ? { readBudget: input.readBudget } : {}),
  });
  /** Fires the one waiting attempt, then lets what it started finish. */
  const fireNext = async () => {
    const next = timers.shift();
    next?.fire();
    await settle();
    return next?.ms ?? null;
  };
  return {
    controller,
    recovery,
    seen,
    timers,
    fireNext,
    refreshes: () => refreshes,
    advance: (ms: number) => void (nowMs += ms),
  };
};

test('each reported state asks one thing of recovery', () => {
  assert({
    given: 'every connection state and failure kind',
    should:
      'read again on a live connection, admit again only once released, and set no timer for what cannot pass by itself',
    actual: [
      decideMediaRecovery('out-of-date', 'transient'),
      decideMediaRecovery('out-of-date', 'definite'),
      decideMediaRecovery('unavailable', 'transient'),
      decideMediaRecovery('unavailable', 'definite'),
      decideMediaRecovery('unavailable', 'refused'),
      decideMediaRecovery('live', undefined),
      decideMediaRecovery('reconnecting', undefined),
      decideMediaRecovery('ended', undefined),
    ],
    expected: [
      'wake',
      'none',
      'rejoin',
      'refresh',
      'refresh',
      'none',
      'none',
      'none',
    ],
  });
});

test('the one classifier names every media answer', () => {
  const kinds = (statuses: readonly number[]) =>
    statuses.map((status) => failureKind(mediaFailure(status)));
  assert({
    given:
      'answers that may pass, answers about authority, and everything else',
    should: 'class each by whether it can pass by itself',
    actual: [
      kinds([408, 429, 500, 502, 503, 504]),
      kinds([401, 403, 404, 410]),
      kinds([400, 409, 422]),
    ],
    expected: [
      Array(6).fill('transient'),
      Array(4).fill('refused'),
      Array(3).fill('definite'),
    ],
  });
});

test('an error that only claims a name mints no media authority', async () => {
  const named = Object.assign(new Error('forged'), {
    name: 'MediaRefusedError',
  });
  let reads = 0;
  let stops = 0;
  const { controller, seen } = recovering({
    reconcile: async () => {
      if (++reads === 2) throw named;
      return snapshot;
    },
    transport: () => transportStub({ stopTracks: () => void stops++ }),
  });
  await controller.join();
  await controller.reconcile({ kind: 'wake' });
  assert({
    given: 'a read rejected by a plain error named like a refusal',
    should: 'keep the live connection and its tracks',
    actual: [failureKind(named), seen.at(-1), stops],
    expected: ['definite', 'out-of-date', 0],
  });
  controller.stop();
});

test('live reads that all fail keep the connection, then recover on it without Retry (DEC-283)', async () => {
  let admits = 0;
  let created = 0;
  let stops = 0;
  let healthy = false;
  const applied: RoundMediaState[] = [];
  let reads = 0;
  const { controller, seen, timers, fireNext } = recovering({
    admit: async () => {
      admits++;
      return admission;
    },
    reconcile: async () => {
      if (++reads > 1 && !healthy) throw transientMediaFailure();
      return snapshot;
    },
    transport: () => {
      created++;
      return transportStub({
        apply: async (state) => void applied.push(state),
        stopTracks: () => void stops++,
      });
    },
  });
  await controller.join();
  await controller.reconcile({ kind: 'wake' });
  const whileStalled = {
    state: controller.state(),
    waiting: timers.map((timer) => timer.ms),
  };
  const first = await fireNext();
  const second = await fireNext();
  healthy = true;
  applied.length = 0;
  await fireNext();
  assert({
    given: 'a live connection whose reads fail until the server is healthy',
    should:
      'show out of date, read again at paced delays, and return to live with the same transport, tracks and admission',
    actual: {
      whileStalled,
      paced: [first, second],
      state: controller.state(),
      applied,
      admits,
      created,
      stops,
      waiting: timers.length,
      reconnected: seen.includes('reconnecting'),
    },
    expected: {
      whileStalled: { state: 'out-of-date', waiting: [1_000] },
      paced: [1_000, 2_000],
      state: 'live',
      applied: [snapshot],
      admits: 1,
      created: 1,
      stops: 0,
      waiting: 0,
      reconnected: false,
    },
  });
  controller.stop();
});

test('a malformed reply says out of date as definite, and sets no timer', async () => {
  let reads = 0;
  const kinds: unknown[] = [];
  const timers: unknown[] = [];
  const recovery = createMediaRecovery({
    delaysMs,
    eventFloorMs: 5_000,
    now: () => 0,
    schedule: (fire) => {
      timers.push(fire);
      return () => undefined;
    },
    rejoin: () => undefined,
    wake: () => undefined,
    refresh: () => undefined,
  });
  const controller = createMediaController({
    roundId,
    initialRoundViewVersion: 1,
    api: {
      admit: async () => admission,
      reconcile: async () =>
        ++reads === 2 ? { version: 'not a state' } : snapshot,
    },
    transport: transportStub,
    changed: (state, failure) => {
      kinds.push([state, failure]);
      recovery.changed(state, failure);
    },
  });
  await controller.join();
  await controller.reconcile({ kind: 'wake' });
  const afterMalformed = kinds.at(-1);
  await controller.reconcile({ kind: 'view', roundViewVersion: 2 });
  assert({
    given: 'a reply that cannot parse on a live connection, then a newer view',
    should:
      'report it as not passing by itself, set no timer, and let the next answered read restore live',
    actual: {
      afterMalformed,
      timers: timers.length,
      state: controller.state(),
    },
    expected: {
      afterMalformed: ['out-of-date', 'definite'],
      timers: 0,
      state: 'live',
    },
  });
  controller.stop();
});

test('a paced rejoin is one admission, and only a connection that held resets the pace', async () => {
  let admits = 0;
  let failing = true;
  const { controller, timers, fireNext, advance } = recovering({
    admit: async () => {
      admits++;
      if (failing) throw transientMediaFailure();
      return admission;
    },
  });
  await controller.join();
  const firstJoin = admits;
  const first = timers.map((timer) => timer.ms);
  await fireNext();
  const onePerCycle = admits - firstJoin;
  await fireNext();
  await fireNext();
  const capped = timers.map((timer) => timer.ms);
  failing = false;
  await fireNext();
  const live = { state: controller.state(), waiting: timers.length };
  // Dropped again at once: this connection never held, so the pace carries on.
  controller.dropped();
  const flapped = timers.map((timer) => timer.ms);
  await fireNext();
  const admitsBeforeHeld = admits;
  advance(5_000);
  failing = true;
  controller.dropped();
  await fireNext();
  assert({
    given: 'admissions refused for now, then a connection that drops',
    should:
      'retry the first join, make each paced rejoin one admission, keep the pace through a flap, and reset once it held',
    actual: {
      firstJoin,
      first,
      onePerCycle,
      capped,
      live,
      flapped,
      afterHeld: {
        attempted: admits - admitsBeforeHeld,
        next: timers.map((timer) => timer.ms),
      },
    },
    expected: {
      firstJoin: MEDIA_RETRY_DELAYS_MS.length + 1,
      first: [1_000],
      onePerCycle: 1,
      capped: [4_000],
      live: { state: 'live', waiting: 0 },
      flapped: [4_000],
      afterHeld: { attempted: 1, next: [2_000] },
    },
  });
  controller.stop();
});

test('a failed media connection is an outage, so it rejoins by itself', async () => {
  let connects = 0;
  let admits = 0;
  const { controller, timers, fireNext } = recovering({
    admit: async () => {
      admits++;
      return admission;
    },
    transport: () =>
      transportStub({
        connect: async () => {
          if (++connects === 1) throw transientMediaFailure();
        },
      }),
  });
  await controller.join();
  const after = { state: controller.state(), waiting: timers.length };
  await fireNext();
  assert({
    given: 'a healthy admission whose LiveKit connection fails once',
    should: 'wait one paced delay and reach live without Retry',
    actual: { after, state: controller.state(), connects, admits },
    expected: {
      after: { state: 'unavailable', waiting: 1 },
      state: 'live',
      connects: 2,
      admits: 2,
    },
  });
  controller.stop();
});

test('a stop leaves no recovery behind', async () => {
  const { controller, recovery, timers } = recovering({
    admit: async () => {
      throw transientMediaFailure();
    },
  });
  await controller.join();
  const waiting = timers.length;
  recovery.stop();
  controller.stop();
  assert({
    given: 'an attempt waiting when the session ends',
    should: 'cancel its one timer',
    actual: [waiting, timers.length],
    expected: [1, 0],
  });
});

test('with every session request held, nothing multiplies admissions', async () => {
  const held: ReturnType<typeof Promise.withResolvers<unknown>>[] = [];
  let active = 0;
  let peak = 0;
  const { controller, recovery, fireNext, advance } = recovering({
    admit: async () => {
      const request = Promise.withResolvers<unknown>();
      held.push(request);
      peak = Math.max(peak, ++active);
      try {
        return await request.promise;
      } finally {
        active--;
      }
    },
  });
  void controller.join();
  await settle();
  for (let i = 0; i < 5; i++) recovery.nudge();
  await settle();
  const duringHold = held.length;
  // Each attempt of the first join hits its deadline in turn.
  for (let i = 0; i <= MEDIA_RETRY_DELAYS_MS.length; i++) {
    held[i]!.reject(transientMediaFailure());
    await settle();
  }
  const afterFirstJoin = held.length;
  await fireNext();
  for (let i = 0; i < 5; i++) recovery.nudge();
  await settle();
  const afterRejoin = held.length;
  held.at(-1)!.reject(transientMediaFailure());
  await settle();
  for (let i = 0; i < 5; i++) recovery.nudge();
  await settle();
  const insideFloor = held.length;
  advance(5_000);
  recovery.nudge();
  await settle();
  assert({
    given: 'admissions that hang until their deadline, under an event storm',
    should:
      'run one at a time, ignore events during one, and let an event move a waiting attempt up at most once per floor',
    actual: {
      duringHold,
      afterFirstJoin,
      afterRejoin,
      insideFloor,
      afterFloor: held.length,
      peak,
    },
    expected: {
      duringHold: 1,
      afterFirstJoin: MEDIA_RETRY_DELAYS_MS.length + 1,
      afterRejoin: MEDIA_RETRY_DELAYS_MS.length + 2,
      insideFloor: MEDIA_RETRY_DELAYS_MS.length + 2,
      afterFloor: MEDIA_RETRY_DELAYS_MS.length + 3,
      peak: 1,
    },
  });
  controller.stop();
});

test('an event moves a waiting attempt up, and never restarts what is final', async () => {
  let admits = 0;
  let answer: () => Promise<unknown> = async () => {
    throw transientMediaFailure();
  };
  const { controller, recovery, timers, refreshes, advance } = recovering({
    admit: () => {
      admits++;
      return answer();
    },
  });
  await controller.join();
  const firstJoin = admits;
  advance(5_000);
  answer = async () => {
    throw mediaFailure(403);
  };
  recovery.nudge();
  await settle();
  const afterRefusal = {
    admits: admits - firstJoin,
    waiting: timers.length,
    refresh: refreshes(),
  };
  advance(5_000);
  recovery.nudge();
  await settle();
  assert({
    given: 'a waiting attempt, an online event, a refusal and another event',
    should:
      'attempt at once, then stop: no timer, one fresh view, no further admission',
    actual: { afterRefusal, admits: admits - firstJoin },
    expected: {
      afterRefusal: { admits: 1, waiting: 0, refresh: 1 },
      admits: 1,
    },
  });
  controller.stop();
});

test('a conflict or an unavailable state ends the connection and asks for a fresh view', async () => {
  const after = async (reply: () => Promise<unknown>) => {
    let reads = 0;
    let stops = 0;
    const session = recovering({
      reconcile: async () => (++reads === 1 ? snapshot : reply()),
      transport: () => transportStub({ stopTracks: () => void stops++ }),
    });
    await session.controller.join();
    await session.controller.reconcile({ kind: 'wake' });
    const outcome = [
      session.controller.state(),
      stops,
      session.refreshes(),
      session.timers.length,
    ];
    session.controller.stop();
    return outcome;
  };
  assert({
    given: 'a 409 answer, then a server state of unavailable, on a live read',
    should: 'release its tracks, refresh the Round once and wait for a person',
    actual: [
      await after(async () => {
        throw mediaFailure(409);
      }),
      await after(async () => ({ ...snapshot, state: 'unavailable' })),
    ],
    expected: [
      ['unavailable', 1, 1, 0],
      ['unavailable', 1, 1, 0],
    ],
  });
});

test('Retry keeps a working connection, whether it is live or only out of date', async () => {
  let admits = 0;
  let allowed = 0;
  let stops = 0;
  let reads = 0;
  let failing = false;
  const { controller } = recovering({
    admit: async () => {
      admits++;
      return admission;
    },
    reconcile: async () => {
      reads++;
      if (failing) throw transientMediaFailure();
      return snapshot;
    },
    transport: () =>
      transportStub({
        allowRecapture: () => void allowed++,
        stopTracks: () => void stops++,
      }),
  });
  await controller.join();
  const readsBefore = reads;
  await controller.retry();
  const live = {
    admits,
    stops,
    allowed,
    extraReads: reads - readsBefore,
    state: controller.state(),
  };
  failing = true;
  await controller.reconcile({ kind: 'wake' });
  const stale = controller.state();
  await controller.retry();
  const stillStale = { state: controller.state(), stops, admits };
  failing = false;
  await controller.retry();
  assert({
    given: 'Retry while live, then twice while reads fail and recover',
    should: 'read current grants each time and never replace healthy reception',
    actual: {
      live,
      stale,
      stillStale,
      state: controller.state(),
      stops,
      admits,
    },
    expected: {
      live: { admits: 1, stops: 0, allowed: 1, extraReads: 1, state: 'live' },
      stale: 'out-of-date',
      stillStale: { state: 'out-of-date', stops: 0, admits: 1 },
      state: 'live',
      stops: 0,
      admits: 1,
    },
  });
  controller.stop();
});

test('Retry rebuilds a released connection', async () => {
  let admits = 0;
  let failing = true;
  const { controller, recovery } = recovering({
    admit: async () => {
      admits++;
      if (failing) throw mediaFailure(400);
      return admission;
    },
  });
  await controller.join();
  recovery.stop();
  const before = admits;
  failing = false;
  await controller.retry();
  assert({
    given: 'a connection that never came up, then Retry',
    should: 'take a fresh admission and reach live',
    actual: { admits: admits - before, state: controller.state() },
    expected: { admits: 1, state: 'live' },
  });
  controller.stop();
});

test('reads behind a hung apply offer a way out without a reload (ISSUE-956)', async () => {
  const { budget, advance } = fakeBudget();
  const hung = new Promise<void>(() => undefined);
  let applies = 0;
  let created = 0;
  const { controller } = recovering({
    readBudget: budget,
    transport: () => {
      const instance = ++created;
      return transportStub({
        apply: async () => {
          if (instance === 1 && ++applies === 2) await hung;
        },
      });
    },
  });
  await controller.join();
  void controller.reconcile({ kind: 'view', roundViewVersion: 2 });
  await settle();
  advance(budget.ms);
  const state = controller.state();
  const status = mediaStatus(state, []);
  await controller.retry();
  assert({
    given: 'an SDK apply that never settles past the read budget',
    should:
      'stop claiming a check is running, offer Retry, and reach live on a new transport',
    actual: {
      state,
      checking: status.message.includes('Checking'),
      retry: status.retry,
      after: controller.state(),
      created,
    },
    expected: {
      state: 'out-of-date',
      checking: false,
      retry: true,
      after: 'live',
      created: 2,
    },
  });
  controller.stop();
});

test('an online or visible event reads again on a live page, at most once per floor', async () => {
  let reads = 0;
  const { controller, recovery, advance } = recovering({
    reconcile: async () => {
      reads++;
      return snapshot;
    },
  });
  await controller.join();
  const before = reads;
  advance(5_000);
  recovery.nudge();
  await settle();
  const first = reads - before;
  recovery.nudge();
  await settle();
  assert({
    given: 'a live page, an online event, and another right after',
    should: 'read once for the first and nothing for the second',
    actual: [first, reads - before],
    expected: [1, 1],
  });
  controller.stop();
});

test('a dropped connection is released at once, so nothing reads on it and Retry rebuilds', async () => {
  let reads = 0;
  let stops = 0;
  let created = 0;
  let readsFail = false;
  const { controller, recovery, timers, fireNext, advance } = recovering({
    reconcile: async () => {
      reads++;
      if (readsFail) throw transientMediaFailure();
      return snapshot;
    },
    transport: () => {
      created++;
      return transportStub({ stopTracks: () => void stops++ });
    },
  });
  await controller.join();
  advance(5_000);
  recovery.nudge();
  await settle();
  // An outage: a wake read fails and LiveKit's drop arrives right after.
  readsFail = true;
  void controller.reconcile({ kind: 'wake' });
  await settle();
  controller.dropped();
  const readsBefore = reads;
  const dropped = {
    state: controller.state(),
    stops,
    status: mediaStatus(controller.state(), [], { failure: 'transient' }).retry,
  };
  await controller.reconcile({ kind: 'wake' });
  const inertWake = reads - readsBefore;
  readsFail = false;
  await fireNext();
  assert({
    given: 'a read failing, then a drop, then a wake and the network returning',
    should:
      'show unavailable with Retry at once, read nothing on the dead connection, and reach live on a new one',
    actual: {
      dropped,
      inertWake,
      state: controller.state(),
      created,
      waiting: timers.length,
    },
    expected: {
      dropped: { state: 'unavailable', stops: 1, status: true },
      inertWake: 0,
      state: 'live',
      created: 2,
      waiting: 0,
    },
  });
  controller.stop();
});

test('a publish that hangs on the first apply still reaches a way out', async () => {
  const { budget, advance: advanceBudget } = fakeBudget();
  let created = 0;
  const { controller, timers, fireNext } = recovering({
    readBudget: budget,
    transport: () => {
      const instance = ++created;
      return transportStub({
        apply: async () => {
          if (instance === 1) await new Promise(() => undefined);
        },
      });
    },
  });
  void controller.join();
  await settle();
  const before = controller.state();
  advanceBudget(budget.ms);
  const after = {
    state: controller.state(),
    retry: mediaStatus(controller.state(), [], { failure: 'transient' }).retry,
    waiting: timers.length,
  };
  await fireNext();
  assert({
    given: 'a first apply that never settles past the read budget',
    should: 'release it, offer Retry, and rejoin by itself on a new transport',
    actual: { before, after, state: controller.state(), created },
    expected: {
      before: 'connecting',
      after: { state: 'unavailable', retry: true, waiting: 1 },
      state: 'live',
      created: 2,
    },
  });
  controller.stop();
});

test('a seat replaced elsewhere is named and sets no timer', async () => {
  const { controller, timers, refreshes } = recovering({});
  await controller.join();
  controller.replaced();
  const status = mediaStatus(controller.state(), [], { failure: 'replaced' });
  assert({
    given: 'this seat connecting from another tab or device',
    should: 'say so, offer to take it back, and not fight for it',
    actual: {
      state: controller.state(),
      waiting: timers.length,
      refreshes: refreshes(),
      named: status.message.includes('another tab or device'),
      retry: status.retry,
    },
    expected: {
      state: 'unavailable',
      waiting: 0,
      refreshes: 1,
      named: true,
      retry: true,
    },
  });
  controller.stop();
});
