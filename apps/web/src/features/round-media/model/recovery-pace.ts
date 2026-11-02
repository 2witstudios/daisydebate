import type { PlannedEffect } from './media-step';
import type { MediaPolicy, RecoveryPace } from './media-state';
import { schedule } from './media-step';

/** Sets the one timer. The pace resets only once a connection has held for the floor. */
export function armRecovery(
  recovery: RecoveryPace,
  atMs: number,
  policy: MediaPolicy,
): {
  readonly recovery: RecoveryPace;
  readonly effects: readonly PlannedEffect[];
} {
  const held =
    recovery.heldSinceMs !== null &&
    atMs - recovery.heldSinceMs >= policy.eventFloorMs;
  const step = held ? 0 : recovery.step;
  const delays = policy.recoveryDelaysMs;
  const ms = delays[Math.min(step, delays.length - 1)];
  if (ms === undefined) return { recovery, effects: [] };
  return {
    recovery: { ...recovery, step: step + 1, heldSinceMs: null },
    effects: [schedule('recovery', ms)],
  };
}

export const clearOfEventFloor = (
  recovery: RecoveryPace,
  atMs: number,
  policy: MediaPolicy,
) =>
  recovery.lastAttemptMs === null ||
  atMs - recovery.lastAttemptMs >= policy.eventFloorMs;
