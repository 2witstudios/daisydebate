import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundMediaAdmission } from '@daisy/protocol';
import {
  CHECKED_DEVICE_MISSING,
  createMediaController,
  isTransientMediaFailure,
  mediaFailure,
  transientMediaFailure,
} from './media-controller';
setupRitewayBun();

const noRecovery = {
  delaysMs: [],
  schedule: () => null,
  cancel: () => undefined,
};
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
    recovery: noRecovery,
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
    recovery: noRecovery,
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
    recovery: noRecovery,
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

/** A controller whose transient refusals are retried through recorded pauses. */
const retryingController = (api: {
  readonly admit: () => Promise<unknown>;
  readonly reconcile: () => Promise<unknown>;
}) => {
  const states: string[] = [];
  const waits: number[] = [];
  const controller = createMediaController({
    recovery: noRecovery,
    roundId,
    api,
    transport: transportStub,
    changed: (state) => states.push(state),
    retry: {
      delaysMs: [500, 1000, 2000],
      wait: async (ms) => {
        waits.push(ms);
      },
    },
  });
  return { controller, states, waits };
};

test('a transient admission refusal is retried before media is called unavailable', async () => {
  let admits = 0;
  const { controller, states, waits } = retryingController({
    admit: async () => {
      if (++admits < 3) throw transientMediaFailure();
      return admission;
    },
    reconcile: async () => snapshot,
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
  const { controller, states, waits } = retryingController({
    admit: async () => admission,
    reconcile: async () => {
      // The join's first read and the live read's first try are refused for now.
      if (++reconciles % 2 === 1) throw transientMediaFailure();
      return snapshot;
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
      recovery: noRecovery,
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

test('only a missing checked device says so; an unchecked missing device is blocked', async () => {
  const stateAfter = async (failure: Error) => {
    const controller = createMediaController({
      recovery: noRecovery,
      roundId,
      api: { admit: async () => admission, reconcile: async () => snapshot },
      transport: () => ({
        connect: async () => undefined,
        apply: async () => {
          throw failure;
        },
        stopTracks: () => undefined,
        disconnect: async () => undefined,
      }),
      changed: () => undefined,
    });
    await controller.join();
    return controller.state();
  };
  assert({
    given:
      'a checked device gone when Round capture starts, then no device at all for a viewer who never checked one',
    should:
      'report the missing checked device, and the default case as blocked, never naming a check that did not happen',
    actual: [
      await stateAfter(
        Object.assign(new Error('Checked device missing'), {
          name: CHECKED_DEVICE_MISSING,
        }),
      ),
      await stateAfter(
        new DOMException('private device detail', 'NotFoundError'),
      ),
    ],
    expected: ['device-missing', 'device-blocked'],
  });
});

test('the request boundary classifies authorization refusals final and temporary failures recoverable (ISSUE-880)', async () => {
  const stateAfter = async (failure: () => unknown) => {
    const changed: string[] = [];
    const controller = createMediaController({
      recovery: noRecovery,
      roundId,
      api: {
        admit: async () => {
          throw failure();
        },
        reconcile: async () => snapshot,
      },
      transport: transportStub,
      changed: (state) => void changed.push(state),
    });
    await controller.join();
    const finalState = controller.state();
    controller.stop();
    return [finalState, changed];
  };
  const authorization = [401, 403, 404].map((status) => mediaFailure(status));
  const temporary = [408, 429, 500, 502, 503, 504].map((status) =>
    mediaFailure(status),
  );
  const network = transientMediaFailure();
  const denied = await Promise.all(
    authorization.map((failure) => stateAfter(() => failure)),
  );
  const recoverable = await stateAfter(() => temporary[0]);
  assert({
    given:
      '401/403/404 answers, one 408/429/5xx answer, and a network refusal at the actual request boundary',
    should:
      'deny authorization refusals without recovery, and keep every temporary or network refusal unavailable for paced recovery',
    actual: {
      authorizationStates: denied.map(([state]) => state),
      authorizationRetryable: authorization.map((failure) =>
        isTransientMediaFailure(failure),
      ),
      temporaryRetryable: temporary.map((failure) =>
        isTransientMediaFailure(failure),
      ),
      temporaryState: recoverable[0],
      networkRetryable: isTransientMediaFailure(network),
    },
    expected: {
      authorizationStates: ['denied', 'denied', 'denied'],
      authorizationRetryable: [false, false, false],
      temporaryRetryable: [true, true, true, true, true, true],
      temporaryState: 'unavailable',
      networkRetryable: true,
    },
  });
});

/** One owned, generation-guarded recovery timer: deterministic scheduler. */
const scheduled = () => {
  const timers: {
    fire: () => void;
    cancelled: boolean;
    fired: boolean;
  }[] = [];
  return {
    timers,
    drain: async () => {
      for (let index = 0; index < 200; index++) await Promise.resolve();
    },
    schedule: (fire: () => void) => {
      const timer = { fire, cancelled: false, fired: false };
      timers.push(timer);
      return timer;
    },
    cancel: (handle: unknown) => {
      (handle as { cancelled: boolean }).cancelled = true;
    },
    /** Fires one timer the way a host timer would: once, then spent. */
    trigger: (timer: { fire: () => void; fired: boolean }) => {
      timer.fired = true;
      timer.fire();
    },
    due: () => timers.filter((timer) => !timer.cancelled && !timer.fired),
  };
};

test('an obsolete recovery timer is inert after a newer attempt failed again (ISSUE-880)', async () => {
  const clock = scheduled();
  let requests = 0;
  const controller = createMediaController({
    roundId,
    api: {
      admit: async () => {
        requests++;
        throw transientMediaFailure();
      },
      reconcile: async () => snapshot,
    },
    transport: transportStub,
    changed: () => undefined,
    retry: { delaysMs: [], wait: async () => undefined },
    recovery: { schedule: clock.schedule, cancel: clock.cancel },
  });
  await controller.join();
  const afterJoin = requests;
  await controller.reconnect();
  const afterReconnect = requests;
  // The first join's timer belongs to a dead generation: firing it must not
  // start a third admission, even though the newer attempt also failed.
  clock.trigger(clock.timers[0]!);
  await clock.drain();
  const staleFired = requests;
  // The current generation's own timer is the only live one.
  clock.trigger(clock.due().at(-1)!);
  await clock.drain();
  assert({
    given:
      'a failed join, a failed manual reconnect, the obsolete timer fired, then the current timer fired',
    should:
      'leave the obsolete generation inert, its handle cancelled or spent, and exactly one live retry for the current generation',
    actual: {
      afterJoin,
      afterReconnect,
      staleFired,
      afterCurrentFired: requests,
      cancelledTimers: clock.timers.filter((timer) => timer.cancelled).length,
      spentTimers: clock.timers.filter(
        (timer) => timer.fired && !timer.cancelled,
      ).length,
      liveTimers: clock.due().length,
    },
    expected: {
      afterJoin: 1,
      afterReconnect: 2,
      staleFired: 2,
      afterCurrentFired: 3,
      cancelledTimers: 1,
      spentTimers: 1,
      liveTimers: 1,
    },
  });
  controller.stop();
});

test('recovery owns one scheduled retry at a time and none survives a stop or success', async () => {
  const clock = scheduled();
  let refusals = 0;
  let grants = 0;
  const controller = createMediaController({
    roundId,
    api: {
      admit: async () => {
        if (refusals === 0) {
          refusals++;
          throw transientMediaFailure();
        }
        grants++;
        return admission;
      },
      reconcile: async () => snapshot,
    },
    transport: transportStub,
    changed: () => undefined,
    retry: { delaysMs: [], wait: async () => undefined },
    recovery: { schedule: clock.schedule, cancel: clock.cancel },
  });
  await controller.join();
  const whileUnavailable = clock.due().length;
  clock.trigger(clock.due().at(-1)!);
  await clock.drain();
  const live = controller.state();
  const afterSuccess = clock.due().length;
  controller.stop();
  assert({
    given:
      'a first refusal then recovery through the timer, and a terminal stop',
    should:
      'hold exactly one live retry while unavailable, none once live, and none resurrecting after stop',
    actual: {
      whileUnavailable,
      live,
      afterSuccess,
      afterStop: clock.due().length,
      grants,
    },
    expected: {
      whileUnavailable: 1,
      live: 'live',
      afterSuccess: 0,
      afterStop: 0,
      grants: 1,
    },
  });
});

test('a definite unsupported HTTP answer does not schedule automatic recovery', async () => {
  const clock = scheduled();
  const controller = createMediaController({
    roundId,
    api: {
      admit: async () => {
        throw mediaFailure(400);
      },
      reconcile: async () => snapshot,
    },
    transport: transportStub,
    changed: () => undefined,
    recovery: { schedule: clock.schedule, cancel: clock.cancel },
  });
  await controller.join();
  assert({
    given: 'a definite 400 admission refusal',
    should:
      'remain unavailable for explicit action without looping the same refused request',
    actual: [controller.state(), clock.due().length],
    expected: ['unavailable', 0],
  });
  controller.stop();
});

test('a superseded request rejection cannot cancel the current recovery timer', async () => {
  const clock = scheduled();
  let rejectOld!: (error: Error) => void;
  let calls = 0;
  const controller = createMediaController({
    roundId,
    api: {
      admit: () => {
        calls++;
        if (calls === 1)
          return new Promise((_, reject) => {
            rejectOld = reject;
          });
        return Promise.reject(transientMediaFailure());
      },
      reconcile: async () => snapshot,
    },
    transport: transportStub,
    changed: () => undefined,
    recovery: { schedule: clock.schedule, cancel: clock.cancel },
  });
  const old = controller.join();
  await controller.reconnect();
  rejectOld(transientMediaFailure());
  await old;
  assert({
    given:
      'an old admission rejecting after a newer attempt scheduled its recovery',
    should: 'preserve the newer generation’s retry timer',
    actual: clock.due().length,
    expected: 1,
  });
  controller.stop();
});

test('a media409 requests fresh Round authority and remains distinct from authorization denial', async () => {
  const clock = scheduled();
  let refreshes = 0;
  const controller = createMediaController({
    roundId,
    api: {
      admit: async () => {
        throw mediaFailure(409);
      },
      reconcile: async () => snapshot,
    },
    transport: transportStub,
    changed: () => undefined,
    refresh: () => {
      refreshes++;
    },
    recovery: { schedule: clock.schedule, cancel: clock.cancel },
  });
  await controller.join();
  assert({
    given:
      '409 from the media contract (authority changed or admission closed)',
    should:
      'request fresh Round authority and pace recovery instead of denying or blindly repeating a definite400',
    actual: [controller.state(), refreshes, clock.due().length],
    expected: ['unavailable', 1, 1],
  });
  controller.stop();
});

test('an unavailable media projection stops publication while retrying a fresh admission', async () => {
  const clock = scheduled();
  const controller = createMediaController({
    roundId,
    api: {
      admit: async () => admission,
      reconcile: async () => ({
        ...snapshot,
        state: 'unavailable',
        grants: { ...snapshot.grants, publish: [], subscribe: false },
      }),
    },
    transport: transportStub,
    changed: () => undefined,
    recovery: { schedule: clock.schedule, cancel: clock.cancel },
  });
  await controller.join();
  assert({
    given:
      'the real media contract’s unavailable projection (unsafe/unresolved or revoked admission)',
    should:
      'tear down current media and retry fresh server admission, leaving any actual authorization refusal final',
    actual: [controller.state(), clock.due().length],
    expected: ['unavailable', 1],
  });
  controller.stop();
});
