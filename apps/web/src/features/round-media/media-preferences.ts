/**
 * Local media preferences for one principal in one Round (ISSUE-879):
 * storage is scoped by principal + Round so choices cannot leak across
 * account switches, and cleanup drops the record at Round end/leave.
 * Only that signed-in principal's own choice is stored, never device
 * identifiers across accounts.
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

/** A local session window, so an inherited host cannot exist: one per entry. */
type Host = {
  readonly session: StorageLike;
  readonly local: StorageLike;
};

const hostFrom = (host?: Partial<Host>): Host => ({
  session: host?.session ?? window.sessionStorage,
  local: host?.local ?? window.localStorage,
});

function* eachKey(storage: Storage) {
  for (let index = 0; index < storage.length; index++)
    yield storage.key(index);
}

/** Every persisting entry a reached Round ends with, for cleanup tests. */
export function* storedMuteKeys(
  roundId: string,
  storage: Storage,
): Generator<string> {
  const prefix = 'daisy:mute:media:';
  for (const key of eachKey(storage))
    if (key?.startsWith(prefix) && key.endsWith(`:${roundId}`)) yield key;
}

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
  if (actorId === null || actorId === 'anonymous') return false;
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
    const kept = hostFrom(host).local.getItem(
      mediaPreferenceKey('mute', actorId, roundId),
    );
    return kept === null ? null : kept === 'muted';
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
    hostFrom(host).local.setItem(
      mediaPreferenceKey('mute', actorId, roundId),
      muted ? 'muted' : 'unmuted',
    );
  } catch {
    // Storage disabled: continuity is per mount only.
  }
}

/** Drop the principal-Round preference when its Round life ends. */
export function clearMutePreference(
  actorId: string | null,
  roundId: string,
  host?: Partial<Host>,
): void {
  try {
    hostFrom(host).local.removeItem(
      mediaPreferenceKey('mute', actorId, roundId),
    );
  } catch {
    // Storage disabled: nothing to clear.
  }
}


