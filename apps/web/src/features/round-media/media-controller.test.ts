import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundMediaAdmission } from '@daisy/protocol';
import {
  createMediaController,
  isTransientMediaFailure,
  mediaFailure,
  transientMediaFailure,
} from './media-controller';
setupRitewayBun();
const roundId = 'r'.repeat(24);
const admission: RoundMediaAdmission = {
  version: 1,
  roundId,
  state: 'ready',
  grants: {
    publish: ['camera', 'microphone'],
    subscribe: true,
    hidden: false,
    capture: false,
  },
  peers: [],
  identity: 'p'.repeat(24),
  token: 'private-token',
  url: 'wss://media.invalid',
  expiresAt: '2026-10-22T09:01:00.000Z',
};

const snapshot = {
  version: admission.version,
  roundId,
  state: admission.state,
  grants: admission.grants,
  peers: admission.peers,
};

test('terminal stop closes tracks immediately while admission is pending', async () => {
  let finish!: (value: RoundMediaAdmission) => void;
  let created = 0;
  const controller = createMediaController({
    roundId,
    api: {
      admit: () =>
        new Promise((accept) => {
          finish = accept;
        }),
      reconcile: async () => snapshot,
    },
    transport: () => {
      created++;
      throw new Error('must never create');
    },
    changed: () => undefined,
  });
  const starting = controller.join();
  controller.stop();
  finish(admission);
  await starting;
  assert({
    given: 'admission resolves after committed terminal stop',
    should: 'never create a transport or reopen media',
    actual: [created, controller.state()],
    expected: [0, 'ended'],
  });
});

test('cleanup never waits for an unfinished publication request', async () => {
  let publish!: () => void;
  const entered = Promise.withResolvers<void>();
  let stopped = 0;
  let disconnected = 0;
  const controller = createMediaController({
    roundId,
    api: { admit: async () => admission, reconcile: async () => snapshot },
    transport: () => ({
      connect: async () => undefined,
      apply: () =>
        new Promise<void>((accept) => {
          publish = accept;
          entered.resolve();
        }),
      stopTracks: () => {
        stopped++;
      },
      disconnect: async () => {
        disconnected++;
      },
    }),
    changed: () => undefined,
  });
  const starting = controller.join();
  await entered.promise;
  controller.stop();
  publish();
  await starting;
  assert({
    given: 'stop during a pending browser device operation',
    should: 'close immediately and again after late completion',
    actual: [stopped >= 2, disconnected >= 1, controller.state()],
    expected: [true, true, 'ended'],
  });
});

test('reconnect obtains a fresh admission and teardown leaves no old transport', async () => {
  let minted = 0;
  const transports: { stopped: number }[] = [];
  const controller = createMediaController({
    roundId,
    api: {
      admit: async () => {
        minted++;
        return admission;
      },
      reconcile: async () => snapshot,
    },
    transport: () => {
      const transport = { stopped: 0 };
      transports.push(transport);
      return {
        connect: async () => undefined,
        apply: async () => undefined,
        stopTracks: () => {
          transport.stopped++;
        },
        disconnect: async () => undefined,
      };
    },
    changed: () => undefined,
  });
  await controller.join();
  await controller.reconnect();
  controller.stop();
  assert({
    given: 'a transport reconnect after admission expiry',
    should: 'mint again and stop every old transport',
    actual: [
      minted,
      transports.length,
      transports.every((transport) => transport.stopped > 0),
    ],
    expected: [2, 2, true],
  });
});

const transportStub = () => ({
  connect: async () => undefined,
  apply: async () => undefined,
  stopTracks: () => undefined,
  disconnect: async () => undefined,
});

test('a transient admission refusal is retried before media is called unavailable', async () => {
  let admits = 0;
  const states: string[] = [];
  const waits: number[] = [];
  const controller = createMediaController({
    roundId,
    api: {
      admit: async () => {
        if (++admits < 3) throw transientMediaFailure();
        return admission;
      },
      reconcile: async () => snapshot,
    },
    transport: transportStub,
    changed: (state) => states.push(state),
    retry: {
      delaysMs: [500, 1000, 2000],
      wait: async (ms) => {
        waits.push(ms);
      },
    },
  });
  await controller.join();
  assert({
    given:
      'an admission refused for now twice (a 503 under load), then granted',
    should: 'wait and retry, reporting reconnecting, then go live (ISSUE-494)',
    actual: { admits, waits, states, final: controller.state() },
    expected: {
      admits: 3,
      waits: [500, 1000],
      states: ['connecting', 'reconnecting', 'reconnecting', 'live'],
      final: 'live',
    },
  });
});

test('a transient reconcile refusal is retried, joining or live', async () => {
  let reconciles = 0;
  const states: string[] = [];
  const waits: number[] = [];
  const controller = createMediaController({
    roundId,
    api: {
      admit: async () => admission,
      reconcile: async () => {
        // The join's first read and the live read's first try are refused for now.
        if (++reconciles % 2 === 1) throw transientMediaFailure();
        return snapshot;
      },
    },
    transport: transportStub,
    changed: (state) => states.push(state),
    retry: {
      delaysMs: [500, 1000, 2000],
      wait: async (ms) => {
        waits.push(ms);
      },
    },
  });
  await controller.join();
  await controller.reconcile();
  assert({
    given:
      'a reconcile refused for now (a 503 under load) while joining, and again once live',
    should:
      'wait and retry both, reporting reconnecting only while joining, and stay live (ISSUE-508)',
    actual: { reconciles, waits, states, final: controller.state() },
    expected: {
      reconciles: 4,
      waits: [500, 500],
      states: ['connecting', 'reconnecting', 'live'],
      final: 'live',
    },
  });
});

test('a lasting or definite admission failure is reported unavailable', async () => {
  const outcome = async (failure: () => Error) => {
    let admits = 0;
    const controller = createMediaController({
      roundId,
      api: {
        admit: async () => {
          admits++;
          throw failure();
        },
        reconcile: async () => snapshot,
      },
      transport: transportStub,
      changed: () => undefined,
      retry: { delaysMs: [1, 1], wait: async () => undefined },
    });
    await controller.join();
    return [admits, controller.state()];
  };
  assert({
    given: 'a refusal that stays transient, and a definite refusal',
    should:
      'stop after the bounded retries, and not retry the definite one at all',
    actual: [
      await outcome(transientMediaFailure),
      await outcome(() => new Error('Media unavailable')),
    ],
    expected: [
      [3, 'unavailable'],
      [1, 'unavailable'],
    ],
  });
});

test('a timeout or a server refusal for now is transient; other refusals are definite', () => {
  const transient = (status: number) =>
    isTransientMediaFailure(mediaFailure(status));
  assert({
    given: 'media answers 408, 503, 409 and 403',
    should:
      'retry the timeout and the refusal for now, and not the definite refusals (ISSUE-494-r1)',
    actual: [408, 503, 409, 403].map(transient),
    expected: [true, true, false, false],
  });
});
