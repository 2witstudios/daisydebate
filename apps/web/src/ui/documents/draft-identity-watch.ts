import {
  DRAFTS_FENCE_EVENT,
  DRAFTS_IDENTITY_CHECK_EVENT,
  DRAFTS_PRINCIPAL_KEY,
  needsSessionRead,
  readSessionPrincipal,
  rootMountAction,
} from './draft-principal';
import type { DraftStorage } from './document-draft-storage';

export type DraftIdentityResources = {
  /** The window: focus, storage and this feature's own events. */
  readonly events: EventTarget;
  /** The document: visibility changes. */
  readonly visibility: EventTarget & { readonly visibilityState: string };
  /** May throw when the browser denies storage. */
  readonly storage: () => DraftStorage;
  readonly fetchSession: (
    signal: AbortSignal,
  ) => Promise<Pick<Response, 'ok' | 'json'>>;
  readonly hasSignOutIntent: () => boolean;
  readonly takeSignOutIntent: () => boolean;
  readonly takeAccountClosedProof: () => boolean;
  readonly publish: (principalId: string | null) => void;
};

/**
 * Follows this browser's identity for the visitor layout's lifetime (ADR 0123). An unavailable
 * server identity is not evidence of logout, so without closure proof that mount
 * publishes nothing, yet still listens for changes from other tabs and settles a
 * sign-out mark on its first session answer. Returns the way to stop.
 */
export function watchDraftIdentity(
  principalId: string | null | undefined,
  resources: DraftIdentityResources,
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
  const unavailable = principalId === undefined;
  // Only the server issues this, so it holds on any mount, whatever identity
  // that mount was rendered with, and nothing publishes over it.
  if (resources.takeAccountClosedProof()) publish(null);
  else if (
    !unavailable &&
    rootMountAction(principalId, resources.takeSignOutIntent()) === 'publish'
  )
    syncPrincipal(principalId);
  const read = async () => {
    if (!live || pending !== null || observed === null) return;
    const controller = new AbortController();
    pending = controller;
    // A live answer only speaks for a mark older than its question. A mark set
    // while it was in flight may be a sign-out still committing.
    const refusable = unavailable && resources.hasSignOutIntent();
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
        if (refusable) resources.takeSignOutIntent();
        syncPrincipal(next);
        return;
      }
      if (unavailable && resources.takeSignOutIntent()) {
        syncPrincipal(null);
        return;
      }
      // Expiry is not a sign-out, so this only fences. A fence can refuse while
      // text is unstored, so later checks ask again, as a known mount does.
      events.dispatchEvent(new Event(DRAFTS_FENCE_EVENT));
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
    if (key === DRAFTS_PRINCIPAL_KEY) syncPrincipal(newValue || null);
  };
  events.addEventListener('focus', check);
  events.addEventListener(DRAFTS_IDENTITY_CHECK_EVENT, read);
  events.addEventListener('storage', otherTab);
  visibility.addEventListener('visibilitychange', visible);
  // A mark must settle even with no copies stored yet, or it could purge text
  // typed later when that session ends.
  if (unavailable) void (resources.hasSignOutIntent() ? read() : check());
  return () => {
    live = false;
    pending?.abort();
    events.removeEventListener('focus', check);
    events.removeEventListener(DRAFTS_IDENTITY_CHECK_EVENT, read);
    events.removeEventListener('storage', otherTab);
    visibility.removeEventListener('visibilitychange', visible);
  };
}
