import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createMediaController,
  type BrowserMediaTransport,
} from './media-controller';
import { admission, snapshot, roundId } from './media-controller.test-support';
import { settle } from './browser-transport.test-support';
setupRitewayBun();

const transport = (
  overrides: Partial<BrowserMediaTransport> = {},
): BrowserMediaTransport => ({
  connect: async () => undefined,
  apply: async () => undefined,
  stopTracks: () => undefined,
  disconnect: async () => undefined,
  ...overrides,
});
const version = (value: number) =>
  ({ kind: 'view', roundViewVersion: value }) as const;

test('a stale ended, mismatched or malformed reply cannot end or fail its successor', async () => {
  const results = [];
  for (const late of [
    { ...snapshot, state: 'ended' },
    { ...snapshot, roundId: 'x'.repeat(24) },
    { nonsense: true },
  ]) {
    const held = Promise.withResolvers<unknown>();
    let reads = 0;
    let stops = 0;
    const controller = createMediaController({
      roundId,
      initialRoundViewVersion: 3,
      api: {
        admit: async () => admission,
        reconcile: async () => (++reads === 2 ? held.promise : snapshot),
      },
      transport: () =>
        transport({
          stopTracks: () => {
            stops++;
          },
        }),
      changed: () => undefined,
    });
    await controller.join();
    const pending = controller.reconcile({ kind: 'wake' });
    await settle();
    await controller.reconcile(version(4));
    held.resolve(late);
    await pending;
    await settle();
    results.push([controller.state(), reads, stops]);
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
  const controller = createMediaController({
    roundId,
    initialRoundViewVersion: 3,
    api: {
      admit: async () => admission,
      reconcile: async () => {
        if (++reads === 3) throw new Error('Definite refusal');
        return snapshot;
      },
    },
    transport: () =>
      transport({
        apply: async () => {
          if (++applies === 2) await applying.promise;
        },
        stopTracks: () => {
          stops++;
        },
      }),
    changed: () => undefined,
  });
  await controller.join();
  const pending = controller.reconcile({ kind: 'wake' });
  await settle();
  await controller.reconcile(version(4));
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
  const controller = createMediaController({
    roundId,
    initialRoundViewVersion: 3,
    api: {
      admit: async () => admission,
      reconcile: async (_id, signal) => {
        seen.push(signal);
        if (++reads !== 2) return snapshot;
        signal.addEventListener('abort', () => {
          void controller.reconcile(version(5));
          void controller.reconcile({ kind: 'wake' });
        });
        return held.promise;
      },
    },
    transport: () => transport(),
    changed: () => undefined,
  });
  await controller.join();
  const pending = controller.reconcile({ kind: 'wake' });
  await settle();
  await controller.reconcile(version(4));
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
  const controller = createMediaController({
    roundId,
    initialRoundViewVersion: 3,
    api: {
      admit: async () => admission,
      reconcile: async () => {
        reads++;
        return snapshot;
      },
    },
    transport: () => transport(),
    changed: (state) => states.push(state),
    received: () => {
      receipts.push(reads);
      if (reads === 1) void controller.reconcile(version(4));
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
  const controller = createMediaController({
    roundId,
    initialRoundViewVersion: 3,
    api: {
      admit: async () => {
        admits++;
        return admission;
      },
      reconcile: async () => {
        if (++reads === 1) throw new Error('Definite refusal');
        return snapshot;
      },
    },
    transport: () => transport(),
    changed: () => undefined,
  });
  await controller.join();
  await controller.reconcile({ kind: 'wake' });
  await controller.reconcile(version(4));
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
    const controller = createMediaController({
      roundId,
      initialRoundViewVersion: 3,
      api: {
        admit: async () => admission,
        reconcile: async () => {
          reads++;
          return snapshot;
        },
      },
      transport: () =>
        transport({
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

test('a reply superseded in any microtask gap never ends or fails its successor', async () => {
  const results = new Set<string>();
  for (const late of [
    { ...snapshot, state: 'ended' },
    { ...snapshot, roundId: 'x'.repeat(24) },
    { ...snapshot, state: 'unavailable' },
  ])
    for (let gap = 0; gap < 12; gap++) {
      const held = Promise.withResolvers<unknown>();
      let reads = 0;
      let stops = 0;
      const controller = createMediaController({
        roundId,
        initialRoundViewVersion: 3,
        api: {
          admit: async () => admission,
          reconcile: async () => (++reads === 2 ? held.promise : snapshot),
        },
        transport: () =>
          transport({
            stopTracks: () => {
              stops++;
            },
          }),
        changed: () => undefined,
      });
      await controller.join();
      const pending = controller.reconcile({ kind: 'wake' });
      await settle();
      held.resolve(late);
      for (let tick = 0; tick < gap; tick++) await Promise.resolve();
      // A reply already acted on is not obsolete; only a live connection counts.
      if (controller.state() === 'live' && stops === 0) {
        void controller.reconcile(version(4));
        await pending;
        await settle();
        results.add(`${controller.state()}:${stops}`);
      }
      controller.stop();
    }
  assert({
    given:
      'a newer view landing in each microtask gap after a bad reply settles',
    should: 'leave the successor live with its connection intact',
    actual: [...results],
    expected: ['live:0'],
  });
});

test('a queued fresh reply superseded while waiting for the old apply never starts', async () => {
  const applying = Promise.withResolvers<void>();
  const replies = [['camera', 'microphone'], ['microphone'], ['camera']];
  let reads = 0;
  const applied: string[] = [];
  const receipts: string[] = [];
  const controller = createMediaController({
    roundId,
    initialRoundViewVersion: 3,
    api: {
      admit: async () => admission,
      reconcile: async () => {
        const publish = reads === 0 ? [] : replies[reads - 1];
        reads++;
        return { ...snapshot, grants: { ...snapshot.grants, publish } };
      },
    },
    transport: () =>
      transport({
        apply: async (state) => {
          applied.push(state.grants.publish.join('+'));
          if (applied.length === 2) await applying.promise;
        },
      }),
    changed: () => undefined,
    received: (state) => receipts.push(state.grants.publish.join('+')),
  });
  await controller.join();
  receipts.length = 0;
  const pending = controller.reconcile({ kind: 'wake' });
  await settle();
  void controller.reconcile(version(4));
  await settle();
  void controller.reconcile(version(5));
  await settle();
  const held = [reads, [...applied]];
  applying.resolve();
  await pending;
  await settle();
  assert({
    given: 'two newer views while an old SDK apply is still running',
    should:
      'read fresh for both, skip the superseded queued apply, and apply and announce only the last',
    actual: [held, applied, receipts],
    expected: [
      [4, ['', 'camera+microphone']],
      ['', 'camera+microphone', 'camera'],
      ['camera'],
    ],
  });
  controller.stop();
});
