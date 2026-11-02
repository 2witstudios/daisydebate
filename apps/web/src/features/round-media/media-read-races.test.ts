import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMediaController } from './media-controller';
import {
  admission,
  readController,
  roundId,
  snapshot,
  transportStub,
  viewAt,
  heldSecondRead,
} from './media-controller.test-support';
import { mediaFailure } from './media-failure';
import { settle } from './browser-transport.test-support';
setupRitewayBun();

test('a stale ended, mismatched or malformed reply cannot end or fail its successor', async () => {
  const results = [];
  for (const late of [
    { ...snapshot, state: 'ended' },
    { ...snapshot, roundId: 'x'.repeat(24) },
    { nonsense: true },
  ]) {
    const { held, controller, pending, reads, stops } = await heldSecondRead();
    await controller.reconcile(viewAt(4));
    held.resolve(late);
    await pending;
    await settle();
    results.push([controller.state(), reads(), stops()]);
    controller.stop();
  }
  assert({
    given: 'an obsolete reply that would end or fail a current read',
    should: 'leave the successor live on the same connection',
    actual: results,
    expected: [
      ['live', 3, 0],
      ['live', 3, 0],
      ['live', 3, 0],
    ],
  });
});

test('an old apply finishing after its successor failed releases what it published', async () => {
  const applying = Promise.withResolvers<void>();
  let reads = 0;
  let applies = 0;
  let stops = 0;
  const controller = readController({
    admit: async () => admission,
    reconcile: async () => {
      if (++reads === 3) throw mediaFailure(403);
      return snapshot;
    },
    transport: () =>
      transportStub({
        apply: async () => {
          if (++applies === 2) await applying.promise;
        },
        stopTracks: () => {
          stops++;
        },
      }),
  });
  await controller.join();
  const pending = controller.reconcile({ kind: 'wake' });
  await settle();
  await controller.reconcile(viewAt(4));
  await settle();
  const failed = [controller.state(), stops];
  applying.resolve();
  await pending;
  await settle();
  assert({
    given:
      'a superseded apply still running when the current read fails definitively',
    should:
      'report the failure and release again once the old apply settles, without reviving media',
    actual: [failed, stops, controller.state()],
    expected: [['unavailable', 1], 2, 'unavailable'],
  });
});

test('events emitted synchronously from an abort still leave one fresh read', async () => {
  let reads = 0;
  const seen: AbortSignal[] = [];
  const held = Promise.withResolvers<unknown>();
  const controller = readController({
    admit: async () => admission,
    reconcile: async (_id, signal) => {
      seen.push(signal);
      if (++reads !== 2) return snapshot;
      signal.addEventListener('abort', () => {
        void controller.reconcile(viewAt(5));
        void controller.reconcile({ kind: 'wake' });
      });
      return held.promise;
    },
  });
  await controller.join();
  const pending = controller.reconcile({ kind: 'wake' });
  await settle();
  await controller.reconcile(viewAt(4));
  await pending;
  await settle();
  assert({
    given: 'a newer view and wake emitted from inside the old abort listener',
    should:
      'serve them from one coalesced fresh read and keep the new signal live',
    actual: [reads, seen[1]?.aborted, seen[2]?.aborted, controller.state()],
    expected: [3, true, false, 'live'],
  });
  controller.stop();
});

test('a newer view emitted from a receipt rereads before announcing live', async () => {
  const states: string[] = [];
  const receipts: number[] = [];
  let reads = 0;
  const controller = readController({
    admit: async () => admission,
    reconcile: async () => {
      reads++;
      return snapshot;
    },
    changed: (state) => states.push(state),
    received: () => {
      receipts.push(reads);
      if (reads === 1) void controller.reconcile(viewAt(4));
    },
  });
  await controller.join();
  await settle();
  assert({
    given: 'the first receipt synchronously supplying a newer view',
    should: 'read once more and only then report the connection live',
    actual: [receipts, states],
    expected: [
      [1, 2],
      ['connecting', 'live'],
    ],
  });
  controller.stop();
});

test('events after failure stay inert until reconnect, which uses the current intent', async () => {
  let reads = 0;
  let admits = 0;
  const controller = readController({
    admit: async () => {
      admits++;
      return admission;
    },
    reconcile: async () => {
      if (++reads === 1) throw mediaFailure(403);
      return snapshot;
    },
  });
  await controller.join();
  await controller.reconcile({ kind: 'wake' });
  await controller.reconcile(viewAt(4));
  await controller.reconcile({
    kind: 'boundary',
    roundViewVersion: 4,
    deadlineMs: 60_000,
  });
  const failed = [controller.state(), reads, admits];
  await controller.reconnect();
  assert({
    given: 'a wake, view and boundary after a definite failure',
    should:
      'not read or readmit by themselves, and reconnect still reaches live once',
    actual: [failed, controller.state(), reads, admits],
    expected: [['unavailable', 1, 1], 'live', 2, 2],
  });
  controller.stop();
});

test('stop during connect releases when the connect later settles either way', async () => {
  const results = [];
  for (const outcome of ['resolve', 'reject'] as const) {
    const connecting = Promise.withResolvers<void>();
    let reads = 0;
    let stops = 0;
    const states: string[] = [];
    const controller = readController({
      admit: async () => admission,
      reconcile: async () => {
        reads++;
        return snapshot;
      },
      transport: () =>
        transportStub({
          connect: () => connecting.promise,
          stopTracks: () => {
            stops++;
          },
        }),
      changed: (state) => states.push(state),
    });
    const joining = controller.join();
    await settle();
    controller.stop();
    await joining;
    const stopped = stops;
    if (outcome === 'resolve') connecting.resolve();
    else connecting.reject(new Error('Late connect failure'));
    await settle();
    results.push([stopped, stops, reads, states.at(-1), states.length]);
  }
  assert({
    given: 'disposal while the SDK connect is pending',
    should:
      'settle join at once, release again after the late connect and stay ended with no read',
    actual: results,
    expected: [
      [1, 2, 0, 'ended', 2],
      [1, 2, 0, 'ended', 2],
    ],
  });
});

test('each read removes its listener from the connection signal', async () => {
  const connection: { signal?: AbortSignal; listeners: number } = {
    listeners: 0,
  };
  const controller = readController({
    admit: async (_id, signal) => {
      connection.signal = signal;
      const add = signal.addEventListener.bind(signal);
      const remove = signal.removeEventListener.bind(signal);
      signal.addEventListener = ((...args: Parameters<typeof add>) => {
        connection.listeners++;
        add(...args);
      }) as typeof signal.addEventListener;
      signal.removeEventListener = ((...args: Parameters<typeof remove>) => {
        connection.listeners--;
        remove(...args);
      }) as typeof signal.removeEventListener;
      return admission;
    },
    reconcile: async () => snapshot,
  });
  await controller.join();
  await settle();
  const baseline = connection.listeners;
  for (let read = 0; read < 5; read++)
    await controller.reconcile({ kind: 'wake' });
  await settle();
  assert({
    given: 'five more completed reads on one connection',
    should: 'add no lasting listener to its signal',
    actual: connection.listeners - baseline,
    expected: 0,
  });
  controller.stop();
});

test('a transport factory that stops the join is released without connecting', async () => {
  let connects = 0;
  let stops = 0;
  const controller = createMediaController({
    roundId,
    initialRoundViewVersion: 3,
    api: { admit: async () => admission, reconcile: async () => snapshot },
    transport: () => {
      controller.stop();
      return transportStub({
        connect: async () => {
          connects++;
        },
        stopTracks: () => {
          stops++;
        },
      });
    },
    changed: () => undefined,
  });
  await controller.join();
  assert({
    given: 'caller code stopping the controller from its transport factory',
    should: 'release the new transport, never connect it, and stay ended',
    actual: [connects, stops, controller.state()],
    expected: [0, 1, 'ended'],
  });
});

test('the failure kind is exposed and a definite live refusal still releases', async () => {
  const seen: [string, string | undefined][] = [];
  let reads = 0;
  let stops = 0;
  const refusal = { value: mediaFailure(503) };
  const controller = readController({
    reconcile: async () => {
      if (++reads === 1) return snapshot;
      throw refusal.value;
    },
    transport: () => transportStub({ stopTracks: () => void stops++ }),
    changed: (state, failure) => seen.push([state, failure]),
  });
  await controller.join();
  await controller.reconcile({ kind: 'wake' });
  const stopsWhileStale = stops;
  refusal.value = mediaFailure(403);
  await controller.reconcile({ kind: 'wake' });
  assert({
    given:
      'a live connection with a transient read failure, then a definite one',
    should:
      'report each kind, keep tracks through the first and release on the second',
    actual: [seen.slice(-2), stopsWhileStale, stops, controller.state()],
    expected: [
      [
        ['out-of-date', 'transient'],
        ['unavailable', 'refused'],
      ],
      0,
      1,
      'unavailable',
    ],
  });
});
