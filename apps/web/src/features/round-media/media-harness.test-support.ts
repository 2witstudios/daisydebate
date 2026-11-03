import type { RoundMediaAdmission, RoundMediaState } from '@daisy/protocol';
import {
  createLiveKitRoom,
  type MediaRoom,
  type MediaSdk,
  type TrackHandle,
} from './adapters/livekit-room';
import { requestFailureOf, transientMediaFailure } from './media-failure';
import type { MediaReadEvent } from './media-read-intent';
import { createMediaRuntime } from './media-runtime';
import {
  initialMediaState,
  type MediaPolicy,
  type MediaState,
  type ObservedTrack,
  type Source,
  type SourceState,
} from './model/media-state';
import { connectionOf } from './model/media-status';
import type { RoomEvent } from './model/media-events';
import { sourceFailureOf, type SourceFailure } from './source-failure';
import {
  admission as admissionFixture,
  roundId as fixtureRound,
  snapshot as snapshotFixture,
} from './media-fixtures.test-support';
import type { CheckedDeviceRead } from '../video/device-selection';

/**
 * Runs behaviour tests through the real runtime, model and adapter, in the shape the
 * tests already speak. Test-only; nothing in production goes through this.
 */
export type MediaConnectionState = ReturnType<typeof connectionOf>;
export type BrowserMediaTransport = {
  readonly connect: (admission: RoundMediaAdmission) => Promise<void>;
  readonly apply: (state: RoundMediaState) => Promise<void>;
  readonly allowRecapture: () => void;
  readonly stopTracks: () => void;
  readonly disconnect: () => Promise<void>;
  readonly opens?: (hooks: RoomHooks) => MediaRoom;
  readonly bridge?: (runtime: ReturnType<typeof createMediaRuntime>) => void;
};
type RoomHooks = {
  readonly report: (event: RoomEvent) => void;
  readonly handles: (handles: readonly TrackHandle[]) => void;
};
export type MediaTrack = TrackHandle & ObservedTrack;
export type { MediaSdk };

const ticks = async (count = 40) => {
  for (let i = 0; i < count; i++) await Promise.resolve();
};

const answeredOf = (link: MediaState['link']) =>
  link.phase === 'live' && link.establishment.stage === 'established'
    ? link.establishment
    : null;

const failureOfLink = (state: MediaState) => {
  if (state.link.phase === 'released') return state.link.why;
  const freshness = answeredOf(state.link)?.freshness;
  return freshness?.status === 'stale' ? freshness.cause : undefined;
};

/** A stub transport as a room: its promises stand in for the SDK's. */
const stubRoom = (
  transport: BrowserMediaTransport,
  hooks: RoomHooks,
  latest: () => RoundMediaState | null,
): MediaRoom => {
  let released = false;
  let applying: Promise<void> | null = null;
  let appliedAnswer: RoundMediaState | null = null;
  const applied = () => {
    const answer = latest();
    if (!answer) return Promise.resolve();
    if (answer !== appliedAnswer) {
      appliedAnswer = answer;
      applying = transport.apply(answer);
    }
    return applying ?? Promise.resolve();
  };
  return {
    connect: async (admission: RoundMediaAdmission) => {
      try {
        await transport.connect(admission);
      } catch (error) {
        hooks.report({
          type: 'connect-failed',
          failure: requestFailureOf(error),
        });
        return;
      }
      hooks.report({ type: 'connected', permission: null });
    },
    capture: async (source: Source) => {
      hooks.report({ type: 'captured', source });
    },
    publish: async (source: Source) => {
      try {
        await applied();
      } catch (error) {
        hooks.report({
          type: 'publish-failed',
          source,
          kind: sourceFailureOf(error).kind,
        });
        return;
      }
      hooks.report({ type: 'published', source });
    },
    unpublish: async (source: Source) => {
      try {
        await applied();
      } catch {
        hooks.report({ type: 'unpublish-failed', source });
        return;
      }
      hooks.report({ type: 'unpublished', source });
    },
    releaseTrack: () => undefined,
    setMuted: async (muted: boolean) =>
      hooks.report({ type: 'mute-applied', muted }),
    startAudio: async () => undefined,
    release: () => {
      if (released) return;
      released = true;
      transport.stopTracks();
      void transport.disconnect().catch(() => undefined);
    },
  } as unknown as MediaRoom;
};

export function createMediaHarness(input: {
  readonly roundId: string;
  readonly initialRoundViewVersion: number;
  readonly api: {
    readonly admit: (roundId: string, signal: AbortSignal) => Promise<unknown>;
    readonly reconcile: (
      roundId: string,
      signal: AbortSignal,
    ) => Promise<unknown>;
  };
  readonly transport: () => BrowserMediaTransport;
  readonly changed?: (state: MediaConnectionState, failure?: string) => void;
  readonly received?: (state: RoundMediaState) => void;
  readonly superseded?: () => void;
  readonly readBudget?: {
    readonly now: () => number;
    readonly ms: number;
    readonly at: (ms: number, fire: () => void) => () => void;
  };
  readonly retry?: {
    readonly delaysMs: readonly number[];
    readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  };
  readonly recoveryDelaysMs?: readonly number[];
  readonly schedule?: (ms: number, fire: () => void) => () => void;
  readonly now?: () => number;
}) {
  const retryDelays = input.retry?.delaysMs ?? [];
  const BUDGET = input.readBudget?.ms ?? 43_500;
  const policy: MediaPolicy = {
    requestRetryDelaysMs: retryDelays,
    readBudgetMs: BUDGET,
    resumeBudgetMs: 5_000,
    capturePatienceMs: 3_000,
    recoveryDelaysMs: input.recoveryDelaysMs ?? [],
    eventFloorMs: 5_000,
  };
  let latestAnswer: RoundMediaState | null = null;
  let room: BrowserMediaTransport | null = null;
  const runtime = createMediaRuntime({
    roundId: input.roundId,
    initial: initialMediaState({
      roundViewVersion: input.initialRoundViewVersion,
      microphoneMuted: false,
    }),
    policy,
    now: () => input.now?.() ?? input.readBudget?.now() ?? 0,
    at: (ms, fire) => {
      if (input.schedule) return input.schedule(ms, fire);
      if (input.retry && retryDelays.includes(ms)) {
        const controller = new AbortController();
        void input.retry.wait(ms, controller.signal).then(() => {
          if (!controller.signal.aborted) fire();
        });
        return () => controller.abort();
      }
      if (input.readBudget && ms !== policy.capturePatienceMs)
        return input.readBudget.at(ms, fire);
      return () => undefined;
    },
    api: {
      admit: input.api.admit,
      reconcile: async (id, signal) => {
        const answer = await input.api.reconcile(id, signal);
        if (
          typeof answer === 'object' &&
          answer !== null &&
          'state' in answer &&
          (answer as RoundMediaState).state === 'ready'
        )
          latestAnswer = answer as RoundMediaState;
        return answer;
      },
    },
    openRoom: (hooks) => {
      room = input.transport();
      room.bridge?.(runtime);
      return room.opens
        ? room.opens(hooks)
        : stubRoom(room, hooks, () => latestAnswer);
    },
    refreshView: () => undefined,
    mute: { remember: () => undefined, forget: () => undefined },
    devices: { forget: () => true, clear: () => undefined },
  });
  let label: MediaConnectionState | null = null;
  let previous = runtime.state();
  const watch = () => {
    const state = runtime.state();
    const next = connectionOf(state);
    const prior = previous;
    previous = state;
    const live = answeredOf(state.link);
    const was = answeredOf(prior.link);
    if (live && live.media !== was?.media) input.received?.(live.media);
    if (
      was?.freshness.status === 'current' &&
      live &&
      live.freshness.status !== 'current'
    )
      input.superseded?.();
    if (
      state.link.phase !== 'waiting' &&
      (next !== label || live?.freshness !== was?.freshness)
    ) {
      if (
        next !== label ||
        (live?.freshness.status === 'stale' && next === 'out-of-date')
      )
        input.changed?.(next, failureOfLink(state));
      label = next;
    }
  };
  runtime.subscribe(watch);
  const idle = () => {
    const { link } = runtime.state();
    if (link.phase === 'admitting' || link.phase === 'connecting') return false;
    if (link.phase !== 'live') return true;
    return (
      link.reads.flight === null &&
      link.reads.next === 'none' &&
      link.apply === null
    );
  };
  const settled = async () => {
    await ticks();
    while (!idle()) {
      const before = runtime.state();
      await new Promise<void>((done) => {
        const stop = runtime.subscribe(() => {
          stop();
          done();
        });
      });
      await ticks();
      if (before === runtime.state() && idle()) break;
    }
  };
  return {
    state: () => connectionOf(runtime.state()),
    runtime,
    join: async () => {
      if (runtime.state().link.phase === 'waiting')
        runtime.dispatch({ type: 'tab-changed', owns: true });
      await settled();
    },
    reconnect: async () => {
      const { link } = runtime.state();
      if (link.phase === 'live')
        runtime.dispatch({ type: 'dropped', connection: link.connection });
      runtime.dispatch({ type: 'retry-pressed' });
      await settled();
    },
    retry: async () => {
      runtime.dispatch({ type: 'retry-pressed' });
      await settled();
    },
    reconcile: async (read: MediaReadEvent) => {
      runtime.dispatch({ type: 'read-requested', read });
      await settled();
    },
    stop: () => runtime.dispatch({ type: 'page-left' }),
  };
}

type TransportEvents = {
  readonly tracks: (tracks: readonly MediaTrack[]) => void;
  readonly remotePeers?: (
    peers: readonly { identity: string; microphonePublished: boolean }[],
  ) => void;
  readonly invalidated: () => void;
  readonly reconnect: () => void;
  readonly replaced?: () => void;
  readonly playbackChanged?: (allowed: boolean) => void;
  readonly microphoneChanged?: (muted: boolean) => void;
  readonly microphoneMuted?: boolean;
  readonly checkedDevices?: () => CheckedDeviceRead;
  readonly missing?: (source: Source) => void;
  readonly sourceFailed?: (
    source: Source,
    failure: { readonly kind: SourceFailure['kind'] | 'removal' },
  ) => void;
  readonly sourceHealthy?: (source: Source) => void;
  readonly sourceWaiting?: (source: Source) => void;
  readonly capturePatience?: (expired: () => void) => () => void;
};

/** Reports source changes in the vocabulary these tests assert. */
const reportSource = (
  events: TransportEvents,
  source: Source,
  was: SourceState,
  now: SourceState,
) => {
  if (was === now) return;
  if (
    was.phase === 'published' &&
    was.swapped &&
    !(now.phase === 'published' && now.swapped)
  )
    events.sourceHealthy?.(source);
  if (now.phase === 'failed') events.sourceFailed?.(source, { kind: now.kind });
  else if (now.phase === 'stale-publication')
    events.sourceFailed?.(source, { kind: 'removal' });
  else if (now.phase === 'missing') events.missing?.(source);
  else if (now.phase === 'published' && now.swapped) events.missing?.(source);
  else if (now.phase === 'capturing' && now.waiting)
    events.sourceWaiting?.(source);
  else if (
    now.phase === 'published' ||
    now.phase === 'warm' ||
    (now.phase === 'off' &&
      (was.phase === 'failed' ||
        was.phase === 'missing' ||
        was.phase === 'stale-publication' ||
        was.phase === 'capturing'))
  )
    events.sourceHealthy?.(source);
};

/** One real room and runtime, with answers given through `apply`. */
export function createBrowserMediaTransport(
  events: TransportEvents,
  sdk: MediaSdk,
) {
  const answers: RoundMediaState[] = [];
  const waiters: ((answer: RoundMediaState) => void)[] = [];
  const nextAnswer = () =>
    new Promise<RoundMediaState>((resolve) => {
      const answer = answers.shift();
      if (answer) resolve(answer);
      else waiters.push(resolve);
    });
  let given: RoundMediaAdmission | null = null;
  const admissionFor = () => given ?? admissionFixture;
  let runtime: ReturnType<typeof createMediaRuntime> | null = null;
  let stopped = false;
  let bridged: ReturnType<typeof createMediaRuntime> | null = null;
  const bridge = (target: ReturnType<typeof createMediaRuntime>) => {
    if (bridged === target) return;
    bridged = target;
    runtime = target;
    let previous = target.state();
    target.subscribe(() => {
      const state = target.state();
      const was = previous;
      previous = state;
      const current = state.link.phase === 'live' ? state.link : null;
      const prior = was.link.phase === 'live' ? was.link : null;
      if (current && prior) {
        for (const source of ['camera', 'microphone'] as const)
          reportSource(
            events,
            source,
            prior.sources[source],
            current.sources[source],
          );
        if (current.peers !== prior.peers) events.remotePeers?.(current.peers);
        if (current.sound !== prior.sound)
          events.playbackChanged?.(current.sound === 'allowed');
      }
      if (prior && !current) events.remotePeers?.([]);
      if (prior && state.link.phase === 'released' && !stopped) {
        if (state.link.why === 'replaced') events.replaced?.();
        else events.reconnect();
      }
    });
  };
  const opens = (hooks: RoomHooks) => {
    let attachable: readonly TrackHandle[] = [];
    return createLiveKitRoom(
      {
        report: (event) => {
          hooks.report(event);
          if (event.type === 'observed')
            events.tracks(
              event.tracks.flatMap((observed) =>
                attachable
                  .filter(
                    (handle) =>
                      handle.identity === observed.identity &&
                      handle.source === observed.source,
                  )
                  .map((handle) => ({ ...observed, ...handle })),
              ),
            );
        },
        handles: (handles) => {
          attachable = handles;
          hooks.handles(handles);
          if (handles.length === 0) events.tracks([]);
        },
        checkedDevices: () =>
          events.checkedDevices?.() ?? { state: 'available', choices: {} },
      },
      sdk,
    );
  };
  const start = (roundId: string) => {
    if (runtime) return runtime;
    const started = createMediaRuntime({
      roundId,
      initial: initialMediaState({
        roundViewVersion: 1,
        microphoneMuted: events.microphoneMuted ?? false,
      }),
      policy: {
        requestRetryDelaysMs: [],
        readBudgetMs: 1e12,
        resumeBudgetMs: 5_000,
        capturePatienceMs: 3_000,
        recoveryDelaysMs: [],
        eventFloorMs: 0,
      },
      now: () => 0,
      at: (ms, fire) =>
        ms === 3_000 && events.capturePatience
          ? events.capturePatience(fire)
          : () => undefined,
      api: {
        admit: async () => admissionFor(),
        reconcile: async () => nextAnswer(),
      },
      openRoom: opens,
      refreshView: () => events.invalidated(),
      mute: {
        remember: (muted) => events.microphoneChanged?.(muted),
        forget: () => undefined,
      },
      devices: { forget: () => true, clear: () => undefined },
    });
    bridge(started);
    started.dispatch({ type: 'tab-changed', owns: true });
    runtime = started;
    return started;
  };
  const live = async () => {
    const started = start(fixtureRound);
    await ticks();
    return started;
  };
  const connectionOfRoom = () => {
    const link = runtime?.state().link;
    return link?.phase === 'live' ? link.connection : null;
  };
  const transport: BrowserMediaTransport = {
    opens,
    bridge,
    connect: async (admission) => {
      given = admission;
      await live();
    },
    apply: async (state) => {
      const started = await live();
      if (started.state().link.phase !== 'live') return;
      const full = {
        ...snapshotFixture,
        ...state,
        grants: { ...snapshotFixture.grants, ...state.grants },
      } as RoundMediaState;
      const waiter = waiters.shift();
      if (waiter) waiter(full);
      else {
        answers.push(full);
        started.dispatch({ type: 'read-requested', read: { kind: 'wake' } });
      }
      await ticks();
      await new Promise<void>((done) => {
        const check = () => {
          const current = started.state().link;
          if (
            current.phase !== 'live' ||
            (current.apply === null && answers.length === 0)
          ) {
            stop?.();
            done();
          }
        };
        const stop: (() => void) | undefined = started.subscribe(check);
        check();
      });
      await ticks();
    },
    allowRecapture: () => {
      runtime?.dispatch({ type: 'retry-pressed' });
    },
    stopTracks: () => {
      stopped = true;
      runtime?.dispatch({ type: 'page-left' });
    },
    disconnect: async () => {
      stopped = true;
      runtime?.dispatch({ type: 'page-left' });
    },
  };
  return {
    transport,
    startAudio: async () => {
      const connection = connectionOfRoom();
      if (connection !== null)
        runtime?.dispatch({ type: 'enable-sound-pressed' });
      await ticks();
    },
    setMicrophoneMuted: async (muted: boolean) => {
      const microphone = () => {
        const link = runtime?.state().link;
        return link?.phase === 'live' ? link.sources.microphone : null;
      };
      const before = microphone();
      runtime?.dispatch({ type: 'mute-requested', muted });
      await ticks();
      const after = microphone();
      if (after !== before && after?.phase === 'failed')
        throw new Error('Mute failed');
    },
  };
}

export { transientMediaFailure };
