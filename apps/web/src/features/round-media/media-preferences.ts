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
  kind: 'mute' | 'left',
  actorId: string | null,
  roundId: string,
): string => `daisy:${kind}:media:${actorId ?? 'anonymous'}:${roundId}`;

/** One browser session window whose own edge bounds every record here. */
type Host = {
  readonly session: StorageLike;
};

const hostFrom = (host?: Partial<Host>): Host => ({
  session: host?.session ?? window.sessionStorage,
});

/**
 * Remember that this principal left this Round explicitly this session, so
 * auto-resume does not fight an explicit departure (session: forgets on close).
 */
export function markDeparture(
  actorId: string | null,
  roundId: string,
  host?: Partial<Host>,
): void {
  try {
    hostFrom(host).session.setItem(
      mediaPreferenceKey('left', actorId, roundId),
      '1',
    );
  } catch {
    // Storage disabled: leaving stays explicit only inside this navigation.
  }
}

/** Whether this principal left this Round explicitly in this session. */
export function departedInSession(
  actorId: string | null,
  roundId: string,
  host?: Partial<Host>,
): boolean {
  if (actorId === null) return false;
  try {
    return (
      hostFrom(host).session.getItem(
        mediaPreferenceKey('left', actorId, roundId),
      ) === '1'
    );
  } catch {
    return false;
  }
}

/** A prior mute choice by this principal in this Round: null until confirmed. */
export function readMutePreference(
  actorId: string | null,
  roundId: string,
  host?: Partial<Host>,
): boolean | null {
  try {
    const kept = hostFrom(host).session.getItem(
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
  host?: Partial<Host>,
): void {
  try {
    hostFrom(host).session.setItem(
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
  host?: Partial<Host>,
): void {
  try {
    hostFrom(host).session.removeItem(
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
  host?: Partial<Host>,
): void {
  clearMutePreference(actorId, roundId, host);
  clearCheckedDevices(roomId, () => hostFrom(host).session, actorId);
}
