import type { MediaEffect } from './media-effects';
import type { MediaPolicy, Recovery } from './media-state';

/** Sets the one timer. The pace resets only once a connection has held for the floor. */
export function armRecovery(
  recovery: Recovery,
  action: 'rejoin' | 'wake',
  atMs: number,
  policy: MediaPolicy,
): { readonly recovery: Recovery; readonly effects: readonly MediaEffect[] } {
  const held =
    recovery.heldSinceMs !== null &&
    atMs - recovery.heldSinceMs >= policy.eventFloorMs;
  const step = held ? 0 : recovery.step;
  const delays = policy.recoveryDelaysMs;
  const ms = delays[Math.min(step, delays.length - 1)];
  if (ms === undefined) return { recovery, effects: [] };
  return {
    recovery: { ...recovery, step: step + 1, heldSinceMs: null, armed: action },
    effects: [
      { type: 'cancel', timer: 'recovery' },
      { type: 'schedule', timer: 'recovery', ms },
    ],
  };
}

export const disarmRecovery = (
  recovery: Recovery,
): { readonly recovery: Recovery; readonly effects: readonly MediaEffect[] } =>
  recovery.armed === null
    ? { recovery, effects: [] }
    : {
        recovery: { ...recovery, armed: null },
        effects: [{ type: 'cancel', timer: 'recovery' }],
      };

export const clearOfEventFloor = (
  recovery: Recovery,
  atMs: number,
  policy: MediaPolicy,
) =>
  recovery.lastAttemptMs === null ||
  atMs - recovery.lastAttemptMs >= policy.eventFloorMs;
