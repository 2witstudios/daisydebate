import {
  roundMediaAdmissionSchema,
  roundMediaStateSchema,
  type RoundMediaAdmission,
} from '@daisy/protocol';
import type { MediaRoom, TrackHandle } from './adapters/livekit-room';
import { cancelMediaWork } from './cancel-media-work';
import { requestFailureOf } from './media-failure';
import type { MediaEffect, MediaTimer } from './model/media-effects';
import type { MediaEvent, RoomEvent } from './model/media-events';
import type { MediaPolicy, MediaState, Source } from './model/media-state';
import { reduceMedia } from './model/reduce-media';

/**
 * Runs the model at the edge. Events queue: an effect's result is always a later
 * event, never a nested reduce, and subscribers see each settled state once. The
 * model fences what arrives late, by connection and ticket.
 */
export function createMediaRuntime(input: {
  readonly roundId: string;
  readonly initial: MediaState;
  readonly policy: MediaPolicy;
  readonly now: () => number;
  readonly at: (ms: number, fire: () => void) => () => void;
  readonly api: {
    readonly admit: (roundId: string, signal: AbortSignal) => Promise<unknown>;
    readonly reconcile: (
      roundId: string,
      signal: AbortSignal,
    ) => Promise<unknown>;
  };
  readonly openRoom: (hooks: {
    readonly report: (event: RoomEvent) => void;
    readonly handles: (handles: readonly TrackHandle[]) => void;
  }) => MediaRoom;
  readonly refreshView: () => void;
  readonly mute: {
    readonly remember: (muted: boolean) => void;
    readonly forget: () => void;
  };
  readonly devices: {
    /** False when the choice could not be removed. */
    readonly forget: (sources: readonly Source[]) => boolean;
    readonly clear: () => void;
  };
}) {
  let state = input.initial;
  let handles: readonly TrackHandle[] = [];
  const listeners = new Set<() => void>();
  const queue: MediaEvent[] = [];
  let draining = false;
  const timers = new Map<MediaTimer, () => void>();
  const rooms = new Map<number, MediaRoom>();
  const admissions = new Map<number, AbortController>();
  const reads = new Map<number, AbortController>();

  const clearTimer = (timer: MediaTimer) => {
    timers.get(timer)?.();
    timers.delete(timer);
  };
  const admit = (connection: number) => {
    const controller = new AbortController();
    admissions.set(connection, controller);
    const { signal } = controller;
    void cancelMediaWork(signal, () => input.api.admit(input.roundId, signal))
      .then((raw) => {
        const admission: RoundMediaAdmission =
          roundMediaAdmissionSchema.parse(raw);
        if (admission.roundId !== input.roundId)
          throw new Error('Media Round mismatch');
        dispatch({ type: 'admission-answered', connection, admission });
      })
      .catch((error: unknown) => {
        if (signal.aborted) return;
        dispatch({
          type: 'admission-failed',
          connection,
          failure: requestFailureOf(error),
        });
      })
      .finally(() => {
        if (admissions.get(connection) === controller)
          admissions.delete(connection);
      });
  };
  const startRead = (ticket: number) => {
    const controller = new AbortController();
    reads.set(ticket, controller);
    const { signal } = controller;
    void cancelMediaWork(signal, () =>
      input.api.reconcile(input.roundId, signal),
    )
      .then((raw) => {
        const answer = roundMediaStateSchema.parse(raw);
        if (answer.roundId !== input.roundId)
          throw new Error('Media Round mismatch');
        dispatch({ type: 'read-answered', ticket, answer });
      })
      .catch((error: unknown) => {
        dispatch(
          signal.aborted
            ? { type: 'read-aborted', ticket }
            : { type: 'read-failed', ticket, failure: requestFailureOf(error) },
        );
      })
      .finally(() => {
        if (reads.get(ticket) === controller) reads.delete(ticket);
      });
  };
  const run = (effect: MediaEffect) => {
    switch (effect.type) {
      case 'admit':
        admit(effect.connection);
        return;
      case 'abort-admission':
        admissions.get(effect.connection)?.abort();
        return;
      case 'connect': {
        const { connection, admission } = effect;
        let room: MediaRoom;
        try {
          room = input.openRoom({
            report: (event) => dispatch({ ...event, connection } as MediaEvent),
            handles: (next) => {
              if (rooms.get(connection) !== room) return;
              handles = next;
              notify();
            },
          });
        } catch {
          dispatch({
            type: 'connect-failed',
            failure: 'transient',
            connection,
          });
          return;
        }
        rooms.set(connection, room);
        void room.connect(admission);
        return;
      }
      case 'release-connection': {
        const room = rooms.get(effect.connection);
        rooms.delete(effect.connection);
        room?.release();
        handles = [];
        return;
      }
      case 'defer-read-start':
        void Promise.resolve().then(() => dispatch({ type: 'read-start-due' }));
        return;
      case 'start-read':
        startRead(effect.ticket);
        return;
      case 'abort-read':
        reads.get(effect.ticket)?.abort();
        return;
      case 'capture':
        void rooms
          .get(effect.connection)
          ?.capture(effect.source, effect.useDefaults);
        return;
      case 'publish':
        void rooms.get(effect.connection)?.publish(effect.source, effect.muted);
        return;
      case 'unpublish':
        void rooms.get(effect.connection)?.unpublish(effect.source);
        return;
      case 'release-track':
        rooms.get(effect.connection)?.releaseTrack(effect.source);
        return;
      case 'set-mute':
        void rooms.get(effect.connection)?.setMuted(effect.muted);
        return;
      case 'start-audio':
        void rooms.get(effect.connection)?.startAudio();
        return;
      case 'schedule': {
        const { timer, ms, id } = effect;
        clearTimer(timer);
        timers.set(
          timer,
          input.at(ms, () => {
            timers.delete(timer);
            dispatch({ type: 'timer-fired', timer, id });
          }),
        );
        return;
      }
      case 'cancel':
        clearTimer(effect.timer);
        return;
      case 'refresh-view':
        input.refreshView();
        return;
      case 'remember-mute':
        input.mute.remember(effect.muted);
        return;
      case 'forget-mute':
        input.mute.forget();
        return;
      case 'forget-checked-devices':
        if (!input.devices.forget(effect.sources))
          dispatch({ type: 'forget-failed', sources: effect.sources });
        return;
      case 'clear-checked-devices':
        input.devices.clear();
        return;
      default: {
        const unknown: never = effect;
        return unknown;
      }
    }
  };
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const dispatch = (event: MediaEvent) => {
    queue.push(event);
    if (draining) return;
    draining = true;
    const before = state;
    try {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const step = reduceMedia(state, next, {
          atMs: input.now(),
          policy: input.policy,
        });
        state = step.state;
        for (const effect of step.effects) run(effect);
      }
    } finally {
      draining = false;
    }
    if (state !== before) notify();
  };
  return {
    state: () => state,
    /** Handles for attaching to elements. Nothing decides from these. */
    handles: () => handles,
    dispatch,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export type MediaRuntime = ReturnType<typeof createMediaRuntime>;
