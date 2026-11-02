import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  fakeBudget,
  readController,
  snapshot,
  transportStub,
  viewAt,
} from './media-controller.test-support';
import type { MediaConnectionState } from './media-controller';
import { mediaFailure, transientMediaFailure } from './media-failure';
import { seatMicrophoneCaption } from './media-status';
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
  const { budget, advance } = fakeBudget();
  let reads = 0;
  const controller = readController({
    readBudget: budget,
    reconcile: () =>
      ++reads === 1 ? Promise.resolve(snapshot) : new Promise(() => undefined),
  });
  await controller.join();
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
const watchedCaption = (input: Parameters<typeof readController>[0]) => {
  let connection: MediaConnectionState = 'connecting';
  let confirmed = true;
  const { budget, advance } = fakeBudget();
  const controller = readController({
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
        peer: { microphone: false },
        confirmed,
        speaking: false,
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

test('a seat cannot stay on checking while an apply never settles', async () => {
  let applies = 0;
  const seat = watchedCaption({
    reconcile: async () => snapshot,
    transport: () =>
      transportStub({
        apply: () =>
          ++applies === 1 ? Promise.resolve() : new Promise(() => undefined),
      }),
  });
  await seat.controller.join();
  void seat.controller.reconcile(viewAt(4));
  await settle();
  const whileChecking = [seat.caption(), seat.controller.state()];
  seat.advance(40_000);
  assert({
    given: 'a newer view whose answer arrives but whose apply never settles',
    should: 'check first, then show out of date at the budget',
    actual: [whileChecking, seat.caption(), seat.controller.state()],
    expected: [
      ['Checking microphone…', 'live'],
      'Microphone status out of date',
      'out-of-date',
    ],
  });
  seat.controller.stop();
});

test('an answer ends the budget, and stopping leaves it inert', async () => {
  const { budget, advance } = fakeBudget();
  const states: string[] = [];
  const controller = readController({
    readBudget: budget,
    reconcile: async () => snapshot,
    changed: (state) => states.push(state),
  });
  await controller.join();
  await controller.reconcile(viewAt(4));
  advance(40_000);
  const afterAnswer = controller.state();
  const held = readController({
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

test('a read let finish cannot hold the fresh read past the young limit', async () => {
  const { budget, advance } = fakeBudget();
  const signals: AbortSignal[] = [];
  let reads = 0;
  const controller = readController({
    readBudget: budget,
    reconcile: (_id, signal) => {
      signals.push(signal);
      return ++reads === 1 || reads === 4
        ? Promise.resolve(snapshot)
        : new Promise(() => undefined);
    },
  });
  await controller.join();
  void controller.reconcile(viewAt(4));
  await settle();
  advance(100);
  void controller.reconcile(viewAt(5));
  await settle();
  advance(100);
  void controller.reconcile(viewAt(6));
  await settle();
  const whileYoung = [signals[2]?.aborted, reads];
  advance(1_900);
  await settle();
  assert({
    given: 'the last event landing on a young read that then stalls',
    should: 'leave it alone while young, then abort it and read fresh',
    actual: [whileYoung, signals[2]?.aborted, reads, controller.state()],
    expected: [[false, 3], true, 4, 'live'],
  });
  controller.stop();
});

test('a read let finish spends no attempt after its retry pause', async () => {
  let nowMs = 0;
  let reads = 0;
  const pause = Promise.withResolvers<void>();
  const inPause = Promise.withResolvers<void>();
  const controller = readController({
    readBudget: { now: () => nowMs, ms: 40_000, at: () => () => undefined },
    retry: {
      delaysMs: [500],
      wait: () => {
        inPause.resolve();
        return pause.promise;
      },
    },
    reconcile: async () => {
      reads++;
      if (reads === 1 || reads >= 4) return snapshot;
      if (reads === 3) throw transientMediaFailure();
      return new Promise(() => undefined);
    },
  });
  await controller.join();
  void controller.reconcile(viewAt(4));
  await settle();
  void controller.reconcile(viewAt(5));
  await inPause.promise;
  const whilePaused = reads;
  nowMs += 100;
  void controller.reconcile(viewAt(6));
  pause.resolve();
  await settle();
  assert({
    given: 'a read in its retry pause, superseded young in a burst',
    should: 'skip its next attempt and go straight to the newest read',
    actual: [whilePaused, reads, controller.state()],
    expected: [3, 4, 'live'],
  });
  controller.stop();
});

test('a first read that cannot pass by itself is labelled definite', async () => {
  const failures: unknown[] = [];
  let reads = 0;
  const controller = readController({
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

/** A joined controller whose second read fails transiently. */
const secondReadFails = async () => {
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
  return { controller, seen, reads: () => reads };
};

test('a local device failure is not overwritten by later reads', async () => {
  const { controller, seen, reads } = await secondReadFails();
  controller.deviceFailed();
  seen.length = 0;
  await controller.reconcile({ kind: 'wake' });
  await controller.reconcile({ kind: 'wake' });
  assert({
    given:
      'a device failure the Round shows, then a stalled and an answered read',
    should: 'emit no state that would hide its Retry',
    actual: [seen, reads()],
    expected: [[], 3],
  });
  controller.stop();
});

test('a device failure while out of date is not overwritten when reads recover', async () => {
  const { controller, seen } = await secondReadFails();
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
  const replies: ReturnType<typeof Promise.withResolvers<unknown>>[] = [];
  const applied: string[] = [];
  const controller = readController({
    readBudget: { now: () => nowMs, ms: 40_000, at: () => () => undefined },
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
    readBudget: { now: () => nowMs, ms: 40_000, at: () => () => undefined },
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
    readBudget: { now: () => nowMs, ms: 40_000, at: () => () => undefined },
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
  const replies: ReturnType<typeof Promise.withResolvers<unknown>>[] = [];
  const controller = readController({
    readBudget: { now: () => 0, ms: 40_000, at: () => () => undefined },
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
