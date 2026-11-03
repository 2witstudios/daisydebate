import { clearCheckedDevices } from '../video/device-selection';

/**
 * Local media preferences for one principal in one Round (ISSUE-879):
 * each record is tab-scoped, so a new tab or a new sign-in starts from the
 * server default; the key still carries the principal and the Round, so
 * nothing reads across accounts. Only that signed-in principal's own choice
 * is stored, never device identifiers that a different account could read.
 */

type StorageLike = Readonly<
  Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
>;

/** Round-scoped key under the actor: this account's choice alone. */
export const mediaPreferenceKey = (
  kind: 'mute',
  actorId: string | null,
  roundId: string,
): string => `daisy:${kind}:media:${actorId ?? 'anonymous'}:${roundId}`;

/** A prior mute choice by this principal in this Round: null until confirmed. */
export function readMutePreference(
  actorId: string | null,
  roundId: string,
  session?: StorageLike,
): boolean | null {
  try {
    const kept = (session ?? window.sessionStorage).getItem(
      mediaPreferenceKey('mute', actorId, roundId),
    );
    return kept === 'muted' ? true : kept === 'unmuted' ? false : null;
  } catch {
    return null;
  }
}

/**
 * Keep the choice only once the mute applied; a failed set keeps the previous
 * record so a remount does not invent a state that never held.
 */
export function writeMutePreference(
  actorId: string | null,
  roundId: string,
  muted: boolean,
  session?: StorageLike,
): void {
  try {
    (session ?? window.sessionStorage).setItem(
      mediaPreferenceKey('mute', actorId, roundId),
      muted ? 'muted' : 'unmuted',
    );
  } catch {
    // Storage disabled: continuity is per mount only.
  }
}

/** Drop one record the Round's life is done with (this principal's alone). */
export function clearMutePreference(
  actorId: string | null,
  roundId: string,
  session?: StorageLike,
): void {
  try {
    (session ?? window.sessionStorage).removeItem(
      mediaPreferenceKey('mute', actorId, roundId),
    );
  } catch {
    // Storage disabled: nothing to clear.
  }
}

/** The Round's local settings die on confirmed departure or observed terminal state. */
export function clearRoundMediaPreferences(
  actorId: string | null,
  roomId: string,
  roundId: string,
  session?: StorageLike,
): void {
  clearMutePreference(actorId, roundId, session);
  clearCheckedDevices(roomId, () => session ?? window.sessionStorage, actorId);
}
