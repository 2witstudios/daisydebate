import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  fakeBudget,
  readHarness,
  snapshot,
  transportStub,
  viewAt,
} from './media-fixtures.test-support';
import type { MediaConnectionState } from './media-harness.test-support';
import { mediaFailure, transientMediaFailure } from './media-failure';
import { seatMicrophoneCaption } from './model/seat-caption';
import { settle } from './adapters/livekit-room.test-support';
setupRitewayBun();

test('only an authority answer ends a live connection', async () => {
  const results = [];
  for (const answer of [401, 403, 404, 409, 410, 429, 500, 502, 504]) {
    let reads = 0;
    let stops = 0;
    const controller = readHarness({
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
  const controller = readHarness({
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

/** Joined on a test budget; every read after the first stalls unless answered. */
const readsStallAfterFirst = async (answeredRead?: number) => {
  const { budget, advance, pending } = fakeBudget();
  const signals: AbortSignal[] = [];
  let reads = 0;
  const controller = readHarness({
    readBudget: budget,
    reconcile: (_id, signal) => {
      signals.push(signal);
      return ++reads === 1 || reads === answeredRead
        ? Promise.resolve(snapshot)
        : new Promise(() => undefined);
    },
  });
  await controller.join();
  return { controller, advance, pending, signals, reads: () => reads };
};

/** Three newer views 100 ms apart, so the last two land on a young read. */
const burstOfThree = async (
  controller: Awaited<ReturnType<typeof readsStallAfterFirst>>['controller'],
  advance: (by: number) => void,
) => {
  void controller.reconcile(viewAt(4));
  await settle();
  advance(100);
  void controller.reconcile(viewAt(5));
  await settle();
  advance(100);
  void controller.reconcile(viewAt(6));
  await settle();
};

test('reads that keep being superseded still show out of date at the budget', async () => {
  const { controller, advance } = await readsStallAfterFirst();
  const states = [];
  for (let view = 4; view <= 13; view++) {
    advance(5_000);
    void controller.reconcile(viewAt(view));
    await settle();
    states.push(controller.state());
  }
  assert({
    given: 'a newer view every 5 s, each aborting a read that never answers',
    should: 'stop showing plain Connected once the stall passes the budget',
    actual: [states[7], states[8]],
    expected: ['live', 'out-of-date'],
  });
  controller.stop();
});

/** A controller driving a seat's caption as the session does, on a test budget. */
const watchedCaption = (input: Parameters<typeof readHarness>[0]) => {
  let connection: MediaConnectionState = 'connecting';
  let confirmed = true;
  const { budget, advance } = fakeBudget();
  const controller = readHarness({
    ...input,
    readBudget: budget,
    changed: (state) => {
      connection = state;
    },
    superseded: () => {
      confirmed = false;
    },
    received: () => {
      confirmed = true;
    },
  });
  return {
    controller,
    advance,
    caption: () =>
      seatMicrophoneCaption({
        connection,
        confirmed,
        track: undefined,
        mine: false,
        ownMuted: false,
        granted: false,
        remote: { microphonePublished: false },
      }),
  };
};

test('a seat checking its microphone cannot stick when no answer comes', async () => {
  let reads = 0;
  let answering = false;
  const seat = watchedCaption({
    reconcile: async () => {
      if (++reads === 1 || answering) return snapshot;
      throw transientMediaFailure();
    },
  });
  await seat.controller.join();
  const answered = seat.caption();
  await seat.controller.reconcile(viewAt(4));
  const unanswered = seat.caption();
  answering = true;
  await seat.controller.reconcile(viewAt(5));
  assert({
    given: 'a read superseded with no answer, then an answer',
    should:
      'stop claiming a state, say out of date rather than checking for ever, and name the state again on the answer',
    actual: [answered, unanswered, seat.caption()],
    expected: [
      'Microphone closed',
      'Microphone status out of date',
      'Microphone closed',
    ],
  });
  seat.controller.stop();
});

test('an answer ends the budget, and stopping leaves it inert', async () => {
  const { budget, advance } = fakeBudget();
  const states: string[] = [];
  const controller = readHarness({
    readBudget: budget,
    reconcile: async () => snapshot,
    changed: (state) => states.push(state),
  });
  await controller.join();
  await controller.reconcile(viewAt(4));
  advance(40_000);
  const afterAnswer = controller.state();
  const held = readHarness({
    readBudget: budget,
    reconcile: async () => snapshot,
  });
  await held.join();
  void held.reconcile(viewAt(4));
  held.stop();
  advance(40_000);
  assert({
    given: 'a budget whose answer came, then one whose connection stopped',
    should: 'never show out of date for either',
    actual: [afterAnswer, held.state(), states.includes('out-of-date')],
    expected: ['live', 'ended', false],
  });
  controller.stop();
});

test('no timer outlives what it was timing', async () => {
  const pendings: number[] = [];
  const scenario = async (
    end: (controller: ReturnType<typeof readHarness>) => Promise<void> | void,
  ) => {
    const { controller, advance, pending } = await readsStallAfterFirst();
    await burstOfThree(controller, advance);
    const armed = pending();
    await end(controller);
    await settle();
    pendings.push(armed, pending());
    controller.stop();
    await settle();
  };
  await scenario((controller) => controller.stop());
  await scenario((controller) => void controller.reconnect());
  assert({
    given:
      'a budget and a let-finish timer running, then a stop or a reconnect',
    should:
      'leave none of its timers behind; a reconnect has only its new first read timed',
    actual: pendings,
    expected: [2, 0, 2, 1],
  });
});

test('a first read that cannot pass by itself is labelled definite', async () => {
  const failures: unknown[] = [];
  let reads = 0;
  const controller = readHarness({
    reconcile: async () => {
      reads++;
      throw reads === 1 ? new Error('Malformed') : transientMediaFailure();
    },
    changed: (_state, failure) => {
      if (failure) failures.push(failure);
    },
  });
  await controller.join();
  await controller.reconnect();
  assert({
    given: 'a malformed first answer, then a transient one, before going live',
    should: 'label each as admission would',
    actual: failures,
    expected: ['definite', 'transient'],
  });
  controller.stop();
});

test('in a burst a young read finishes, is fenced, and the newest read applies', async () => {
  const { budget, advance } = fakeBudget();
  const signals: AbortSignal[] = [];
  const replies: ReturnType<typeof Promise.withResolvers<unknown>>[] = [];
  const applied: string[] = [];
  const controller = readHarness({
    readBudget: budget,
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
  advance(500);
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
  const { controller, advance, signals, reads } = await readsStallAfterFirst();
  void controller.reconcile({ kind: 'wake' });
  await settle();
  void controller.reconcile(viewAt(4));
  await settle();
  advance(2_000);
  void controller.reconcile(viewAt(5));
  await settle();
  assert({
    given: 'a read that has run the whole young limit when a newer view lands',
    should: 'abort it and read fresh, so a stall cannot hold the burst',
    actual: [signals[2]?.aborted, reads()],
    expected: [true, 4],
  });
  controller.stop();
});

test('a fenced read does not spend retries', async () => {
  const { budget, advance } = fakeBudget();
  let reads = 0;
  const first = Promise.withResolvers<unknown>();
  const second = Promise.withResolvers<unknown>();
  const controller = readHarness({
    readBudget: budget,
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
  advance(100);
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
  const replies: ReturnType<typeof Promise.withResolvers<unknown>>[] = [];
  const controller = readHarness({
    readBudget: fakeBudget().budget,
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
