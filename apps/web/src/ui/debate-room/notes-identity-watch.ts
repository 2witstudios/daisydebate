import {
  NOTES_FENCE_EVENT,
  NOTES_IDENTITY_CHECK_EVENT,
  NOTES_PRINCIPAL_KEY,
  needsSessionRead,
  readSessionPrincipal,
  rootMountAction,
} from './notes-principal';
import type { DraftStorage } from './note-draft-storage';

export type NotesIdentityResources = {
  /** The window: focus, storage and this feature's own events. */
  readonly events: EventTarget;
  /** The document: visibility changes. */
  readonly visibility: EventTarget & { readonly visibilityState: string };
  /** May throw when the browser denies storage. */
  readonly storage: () => DraftStorage;
  readonly fetchSession: (
    signal: AbortSignal,
  ) => Promise<Pick<Response, 'ok' | 'json'>>;
  readonly takeSignOutIntent: () => boolean;
  readonly takeAccountClosedProof: () => boolean;
  readonly publish: (principalId: string | null) => void;
};

/**
 * Follows this browser's identity for the root's lifetime. An unavailable
 * server identity is not evidence of logout, so that mount publishes nothing,
 * yet still listens for changes from other tabs. Returns the way to stop.
 */
export function watchNotesIdentity(
  principalId: string | null | undefined,
  resources: NotesIdentityResources,
): () => void {
  const { events, visibility, publish } = resources;
  let observed = principalId;
  let live = true;
  let pending: AbortController | null = null;
  const syncPrincipal = (next: string | null) => {
    if (next !== observed) {
      pending?.abort();
      pending = null;
      observed = next;
    }
    publish(next);
  };
  // Only the server issues this, so it holds on any mount, whatever identity
  // that mount was rendered with.
  if (resources.takeAccountClosedProof()) publish(null);
  // An unavailable mount leaves the sign-out mark for the next known one.
  if (
    principalId !== undefined &&
    rootMountAction(principalId, resources.takeSignOutIntent()) === 'publish'
  )
    syncPrincipal(principalId);
  const read = async () => {
    if (!live || pending !== null || observed === null) return;
    const controller = new AbortController();
    pending = controller;
    try {
      const response = await resources.fetchSession(controller.signal);
      if (!response.ok) return;
      const next = readSessionPrincipal(await response.json());
      if (
        !live ||
        pending !== controller ||
        controller.signal.aborted ||
        next === undefined
      )
        return;
      if (next !== null) {
        syncPrincipal(next);
        return;
      }
      // Expiry is not a sign-out, so this only fences. A fence can refuse while
      // text is unstored, so later checks ask again, as a known mount does.
      events.dispatchEvent(new Event(NOTES_FENCE_EVENT));
    } catch {
      // Offline or cancelled transport never establishes identity loss.
    } finally {
      if (pending === controller) pending = null;
    }
  };
  const check = async () => {
    let needed = observed !== null;
    try {
      needed = needsSessionRead(resources.storage(), observed);
    } catch {
      // A denied storage getter cannot establish that no private copy exists.
    }
    if (needed) await read();
  };
  const visible = () => {
    if (visibility.visibilityState === 'visible') void check();
  };
  const otherTab = (event: Event) => {
    const { key, newValue } = event as StorageEvent;
    if (key === NOTES_PRINCIPAL_KEY) syncPrincipal(newValue || null);
  };
  events.addEventListener('focus', check);
  events.addEventListener(NOTES_IDENTITY_CHECK_EVENT, read);
  events.addEventListener('storage', otherTab);
  visibility.addEventListener('visibilitychange', visible);
  return () => {
    live = false;
    pending?.abort();
    events.removeEventListener('focus', check);
    events.removeEventListener(NOTES_IDENTITY_CHECK_EVENT, read);
    events.removeEventListener('storage', otherTab);
    visibility.removeEventListener('visibilitychange', visible);
  };
}
