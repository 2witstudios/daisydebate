/**
 * Account-switch cleanup (ISSUE-879): a signed-out or switched tab drops
 * every media preference that names no live account, whether those keys name
 * the outgoing account or any other one this browser once held. Only local
 * tab records die here; no server state does.
 */

/** Every media preference kind a tab stores is an actor-scoped record. */
const PREFIXES = ['daisy:mute:media:', 'daisy:checked-devices:'];

export function clearAccountMediaPreferences(host?: Storage | null): void {
  const storage =
    host ?? (typeof window === 'undefined' ? null : window.sessionStorage);
  if (!storage) return;
  const doomed: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key === null) continue;
    if (PREFIXES.some((prefix) => key.startsWith(prefix))) doomed.push(key);
  }
  for (const key of doomed) storage.removeItem(key);
}

/** Observe the signed principal at shell and direct-Round entry before restoration; says whether it changed. */
export function selectMediaAccount(
  actorId: string | null,
  host?: Storage,
): boolean {
  try {
    const storage = host ?? window.sessionStorage;
    const current = actorId ?? 'signed-out';
    const previous = storage.getItem('daisy:media-account');
    const changed = previous !== null && previous !== current;
    if (changed) clearAccountMediaPreferences(storage);
    storage.setItem('daisy:media-account', current);
    return changed;
  } catch {
    // Disabled tab storage holds no restorable choices.
    return false;
  }
}
