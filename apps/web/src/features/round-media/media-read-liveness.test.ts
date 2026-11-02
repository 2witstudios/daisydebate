import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  readController,
  snapshot,
  transportStub,
  viewAt,
} from './media-controller.test-support';
import { mediaFailure } from './media-failure';
import { settle } from './browser-transport.test-support';
setupRitewayBun();

test('only an authority answer ends a live connection', async () => {
  const results = [];
  for (const answer of [401, 403, 404, 409, 410, 429, 500, 502, 504]) {
    let reads = 0;
    let stops = 0;
    const controller = readController({
      reconcile: async () => {
        if (++reads === 1) return snapshot;
        throw mediaFailure(answer);
      },
      transport: () => transportStub({ stopTracks: () => void stops++ }),
    });
    await controller.join();
    await controller.reconcile({ kind: 'wake' });
    results.push([answer, controller.state(), stops]);
    controller.stop();
  }
  assert({
    given: 'each failing status on a live connection',
    should:
      'release only for an answer about authority, and keep tracks otherwise',
    actual: results,
    expected: [
      [401, 'unavailable', 1],
      [403, 'unavailable', 1],
      [404, 'unavailable', 1],
      [409, 'unavailable', 1],
      [410, 'unavailable', 1],
      [429, 'out-of-date', 0],
      [500, 'out-of-date', 0],
      [502, 'out-of-date', 0],
      [504, 'out-of-date', 0],
    ],
  });
});

test('a server reply saying unavailable still ends a live connection', async () => {
  let reads = 0;
  let stops = 0;
  const controller = readController({
    reconcile: async () =>
      ++reads === 1 ? snapshot : { ...snapshot, state: 'unavailable' },
    transport: () => transportStub({ stopTracks: () => void stops++ }),
  });
  await controller.join();
  await controller.reconcile({ kind: 'wake' });
  assert({
    given: 'the server answering that this caller is no longer admitted',
    should: 'release the tracks',
    actual: [controller.state(), stops],
    expected: ['unavailable', 1],
  });
});

test('reads that keep being superseded still show out of date at the budget', async () => {
  let nowMs = 0;
  let reads = 0;
  const controller = readController({
    readBudget: { now: () => nowMs, ms: 40_000 },
    reconcile: () =>
      ++reads === 1 ? Promise.resolve(snapshot) : new Promise(() => undefined),
  });
  await controller.join();
  const states = [];
  for (let view = 4; view <= 13; view++) {
    nowMs += 5_000;
    void controller.reconcile(viewAt(view));
    await settle();
    states.push(controller.state());
  }
  assert({
    given: 'a newer view every 5 s, each aborting a read that never answers',
    should: 'stop showing plain Connected once the stall passes the budget',
    actual: [states[7], states[8], states[9]],
    expected: ['live', 'out-of-date', 'out-of-date'],
  });
  controller.stop();
});

test('a local device failure is not overwritten by later reads', async () => {
  const seen: string[] = [];
  let reads = 0;
  const controller = readController({
    reconcile: async () => {
      reads++;
      if (reads === 2) throw mediaFailure(503);
      return snapshot;
    },
    changed: (state) => seen.push(state),
  });
  await controller.join();
  controller.deviceFailed();
  seen.length = 0;
  await controller.reconcile({ kind: 'wake' });
  await controller.reconcile({ kind: 'wake' });
  assert({
    given:
      'a device failure the Round shows, then a stalled and an answered read',
    should: 'emit no state that would hide its Retry',
    actual: [seen, reads],
    expected: [[], 3],
  });
  controller.stop();
});

test('a device failure while out of date is not overwritten when reads recover', async () => {
  const seen: string[] = [];
  let reads = 0;
  const controller = readController({
    reconcile: async () => {
      reads++;
      if (reads === 2) throw mediaFailure(503);
      return snapshot;
    },
    changed: (state) => seen.push(state),
  });
  await controller.join();
  await controller.reconcile({ kind: 'wake' });
  const stale = seen.at(-1);
  controller.deviceFailed();
  seen.length = 0;
  await controller.reconcile({ kind: 'wake' });
  assert({
    given:
      'a device failure shown while reads are out of date, then an answered read',
    should: 'not announce live over the shown failure',
    actual: [stale, seen],
    expected: ['out-of-date', []],
  });
  controller.stop();
});

test('in a burst a young read finishes, is fenced, and the newest read applies', async () => {
  let nowMs = 0;
  const signals: AbortSignal[] = [];
  const replies: PromiseWithResolvers<unknown>[] = [];
  const applied: string[] = [];
  const controller = readController({
    readBudget: { now: () => nowMs, ms: 40_000 },
    reconcile: (_id, signal) => {
      signals.push(signal);
      const reply = Promise.withResolvers<unknown>();
      replies.push(reply);
      return reply.promise;
    },
    transport: () =>
      transportStub({
        apply: async (state) => {
          applied.push(state.grants.publish.join('+'));
        },
      }),
  });
  const joining = controller.join();
  await settle();
  replies[0]!.resolve(snapshot);
  await joining;
  applied.length = 0;
  void controller.reconcile({ kind: 'wake' });
  await settle();
  void controller.reconcile(viewAt(4));
  await settle();
  const firstAborted = signals[1]!.aborted;
  nowMs += 500;
  void controller.reconcile(viewAt(5));
  await settle();
  const youngAborted = signals[2]!.aborted;
  const readsWhileYoung = replies.length;
  replies[2]!.resolve({
    ...snapshot,
    grants: { ...snapshot.grants, publish: ['microphone'] },
  });
  await settle();
  const fenced = [...applied];
  replies[3]!.resolve({
    ...snapshot,
    grants: { ...snapshot.grants, publish: ['camera'] },
  });
  await settle();
  assert({
    given: 'a second newer view while a young fresh read is in flight',
    should:
      'abort the first read, let the young one finish without applying it, then apply only the newest read',
    actual: { firstAborted, youngAborted, readsWhileYoung, fenced, applied },
    expected: {
      firstAborted: true,
      youngAborted: false,
      readsWhileYoung: 3,
      fenced: [],
      applied: ['camera'],
    },
  });
  controller.stop();
});

test('a read past the young limit is still aborted in a burst', async () => {
  let nowMs = 0;
  const signals: AbortSignal[] = [];
  let reads = 0;
  const controller = readController({
    readBudget: { now: () => nowMs, ms: 40_000 },
    reconcile: (_id, signal) => {
      signals.push(signal);
      return ++reads === 1
        ? Promise.resolve(snapshot)
        : new Promise(() => undefined);
    },
  });
  await controller.join();
  void controller.reconcile({ kind: 'wake' });
  await settle();
  void controller.reconcile(viewAt(4));
  await settle();
  nowMs += 2_000;
  void controller.reconcile(viewAt(5));
  await settle();
  assert({
    given: 'a read that has run the whole young limit when a newer view lands',
    should: 'abort it and read fresh, so a stall cannot hold the burst',
    actual: [signals[2]?.aborted, reads],
    expected: [true, 4],
  });
  controller.stop();
});

test('a fenced read does not spend retries', async () => {
  let nowMs = 0;
  let reads = 0;
  const first = Promise.withResolvers<unknown>();
  const second = Promise.withResolvers<unknown>();
  const controller = readController({
    readBudget: { now: () => nowMs, ms: 40_000 },
    retry: { delaysMs: [1, 1, 1], wait: async () => undefined },
    reconcile: () => {
      reads++;
      if (reads === 1) return Promise.resolve(snapshot);
      if (reads === 2) return first.promise;
      if (reads === 3) return second.promise;
      return Promise.resolve(snapshot);
    },
  });
  await controller.join();
  void controller.reconcile({ kind: 'wake' });
  await settle();
  void controller.reconcile(viewAt(4));
  await settle();
  nowMs += 100;
  void controller.reconcile(viewAt(5));
  await settle();
  second.reject(mediaFailure(503));
  await settle();
  assert({
    given: 'a let-finish read that fails transiently after being superseded',
    should: 'not retry it, and read fresh for the newest view instead',
    actual: [reads, controller.state()],
    expected: [4, 'live'],
  });
  controller.stop();
});

test('an answered read ends the burst, so the next newer view aborts at once', async () => {
  const signals: AbortSignal[] = [];
  const replies: PromiseWithResolvers<unknown>[] = [];
  const controller = readController({
    readBudget: { now: () => 0, ms: 40_000 },
    reconcile: (_id, signal) => {
      signals.push(signal);
      const reply = Promise.withResolvers<unknown>();
      replies.push(reply);
      return reply.promise;
    },
  });
  const joining = controller.join();
  await settle();
  replies[0]!.resolve(snapshot);
  await joining;
  void controller.reconcile({ kind: 'wake' });
  await settle();
  void controller.reconcile(viewAt(4));
  await settle();
  replies[2]!.resolve(snapshot);
  await settle();
  void controller.reconcile({ kind: 'wake' });
  await settle();
  void controller.reconcile(viewAt(5));
  await settle();
  assert({
    given: 'a superseded read, a fresh read that answered, then a newer view',
    should: 'treat it as a new first supersession and abort at once',
    actual: signals[3]?.aborted,
    expected: true,
  });
  controller.stop();
});
