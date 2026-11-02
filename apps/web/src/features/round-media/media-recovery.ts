import type { MediaFailureKind } from './media-failure';
import type { MediaConnectionState } from './media-controller';

/** Paced so a long outage costs little; each attempt is one admission. */
export const MEDIA_RECOVERY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 10_000];
/** Browser events may not bring attempts closer than this; a connection holding this long resets the pace. */
export const MEDIA_RECOVERY_EVENT_FLOOR_MS = 5_000;

export type MediaRecoveryAction = 'rejoin' | 'wake' | 'refresh' | 'none';

/**
 * What a reported state asks of recovery. A live connection whose reads go
 * unanswered keeps its tracks and reads again; only a released connection needs
 * admission. A failure that will not pass by itself gets a fresh view, no timer.
 */
export function decideMediaRecovery(
  state: MediaConnectionState,
  failure: MediaFailureKind | undefined,
): MediaRecoveryAction {
  if (state === 'out-of-date') return failure === 'transient' ? 'wake' : 'none';
  if (state !== 'unavailable') return 'none';
  return failure === 'transient' ? 'rejoin' : 'refresh';
}

/**
 * The one paced owner above the controller: at most one timer, armed only by a
 * reported failure, so an attempt in flight can never be multiplied. The pace
 * resets only once a connection has held for the floor, so one that keeps
 * dropping cannot reach the server faster than a long outage does.
 */
export function createMediaRecovery(input: {
  readonly delaysMs: readonly number[];
  readonly eventFloorMs: number;
  readonly now: () => number;
  readonly schedule: (fire: () => void, ms: number) => () => void;
  readonly rejoin: () => void;
  readonly wake: () => void;
  readonly refresh: () => void;
}) {
  let step = 0;
  let liveSinceMs: number | null = null;
  let lastAttemptMs: number | null = null;
  let connection: MediaConnectionState | null = null;
  let armed: { readonly fire: () => void; readonly cancel: () => void } | null =
    null;
  const disarm = () => {
    armed?.cancel();
    armed = null;
  };
  const clearOfFloor = () =>
    lastAttemptMs === null || input.now() - lastAttemptMs >= input.eventFloorMs;
  const attempt = (act: () => void) => {
    armed = null;
    lastAttemptMs = input.now();
    act();
  };
  const arm = (act: () => void) => {
    if (liveSinceMs !== null && input.now() - liveSinceMs >= input.eventFloorMs)
      step = 0;
    liveSinceMs = null;
    const delayMs = input.delaysMs[Math.min(step, input.delaysMs.length - 1)];
    if (delayMs === undefined) return;
    step++;
    const fire = () => attempt(act);
    armed = { fire, cancel: input.schedule(fire, delayMs) };
  };
  return {
    changed: (
      state: MediaConnectionState,
      failure: MediaFailureKind | undefined,
    ) => {
      disarm();
      connection = state;
      if (state === 'live') liveSinceMs = input.now();
      const action = decideMediaRecovery(state, failure);
      if (action === 'refresh') input.refresh();
      if (action === 'rejoin') arm(input.rejoin);
      if (action === 'wake') arm(input.wake);
    },
    /** The browser says now is a good moment: move a waiting attempt up, or read. */
    nudge: () => {
      if (!clearOfFloor()) return;
      const waiting = armed;
      if (waiting) {
        waiting.cancel();
        waiting.fire();
      } else if (connection === 'live') attempt(input.wake);
    },
    stop: disarm,
  };
}
