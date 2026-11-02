import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMediaController } from './media-controller';
import { createRoundMediaOperations } from './operations';
import { createMediaRequest } from './request-media';
import { createMediaWorld } from './media-world.test-support';
import { createTimerQueue } from '../realtime/connection-store.test-support';
setupRitewayBun();

const LEASE_MS = 15_000;
const POLL_MS = 25;
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);
};

test('an admission that waits out a full lease still connects within the retry budget', async () => {
  const timer = createTimerQueue((now, delay) => now + delay);
  const world = createMediaWorld();
  const after = (ms: number) =>
    new Promise<void>((done) => void timer.setTimeout(done, ms));
  // The double grants every claim; a real lease has one holder at a time.
  const { store } = world.input;
  const claim = store.claimMediaReconcile;
  const finish = store.finishMediaReconcile;
  let held = false;
  store.claimMediaReconcile = (async (...args: Parameters<typeof claim>) => {
    if (timer.now() < LEASE_MS || held) return { kind: 'busy' };
    held = true;
    return claim(...args);
  }) as typeof claim;
  store.finishMediaReconcile = (async (...args: Parameters<typeof finish>) => {
    held = false;
    return finish(...args);
  }) as typeof finish;
  const entering = new Set<string>();
  let maxWaiters = 0;
  const { priority } = world.input;
  const trackedPriority = (async (...args: Parameters<typeof priority>) => {
    const [, operation, owner] = args;
    if (operation === 'enter') entering.add(owner!);
    if (operation === 'leave') entering.delete(owner!);
    maxWaiters = Math.max(maxWaiters, entering.size);
    return priority(...args);
  }) as typeof priority;
  const operations = createRoundMediaOperations({
    ...world.input,
    wait: () => after(POLL_MS),
    priority: trackedPriority,
  });
  const actor = world.seats[0].actorId;
  const counts = { sessions: 0, minted: 0, connects: 0, liveAtMs: -1 };
  const request = createMediaRequest({
    scheduleDeadline: (expire) => {
      const id = timer.setTimeout(expire, 10_000);
      return () => timer.clearTimeout(id);
    },
    fetch: async (url) => {
      if (!String(url).endsWith('/session'))
        return Response.json(await operations.reconcile(world.roundId, actor));
      counts.sessions++;
      const admitted = await operations.session(world.roundId, actor);
      counts.minted++;
      return Response.json(admitted);
    },
  });
  const controller = createMediaController({
    roundId: world.roundId,
    initialRoundViewVersion: 1,
    api: {
      admit: (id, signal) => request(id, 'session', signal),
      reconcile: (id, signal) => request(id, 'reconcile', signal),
    },
    retry: { delaysMs: [500, 1_000, 2_000], wait: (ms) => after(ms) },
    transport: () => ({
      connect: async () => {
        counts.connects++;
      },
      apply: async () => undefined,
      stopTracks: () => undefined,
      disconnect: async () => undefined,
    }),
    changed: (state) => {
      if (state === 'live') counts.liveAtMs = timer.now();
    },
  });
  void controller.join();
  for (
    let at = 0;
    at < 60_000 && controller.state() !== 'unavailable';
    at += POLL_MS
  ) {
    timer.advance(POLL_MS);
    await flush();
    if (counts.liveAtMs >= 0 && entering.size === 0) break;
  }
  // The server call the client abandoned keeps running; let it finish.
  for (let i = 0; i < 40; i++) {
    timer.advance(POLL_MS);
    await flush();
  }
  const result = {
    state: controller.state(),
    withinBudget: counts.liveAtMs > 0 && counts.liveAtMs <= 43_500,
    connects: counts.connects,
    sessions: counts.sessions,
    // The abandoned call is not cancelled: its short-lived token is never used.
    minted: counts.minted,
    maxWaiters,
    waitersLeft: entering.size,
  };
  assert({
    given:
      'a session lease held for its full 15 s, longer than the 10 s deadline',
    should:
      'connect once on a retry, with the abandoned waiter bounded and drained',
    actual: result,
    expected: {
      state: 'live',
      withinBudget: true,
      connects: 1,
      sessions: 2,
      minted: 2,
      maxWaiters: 2,
      waitersLeft: 0,
    },
  });
  controller.stop();
});
