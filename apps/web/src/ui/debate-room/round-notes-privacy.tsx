'use client';

import { useEffect, useState } from 'react';
import {
  NOTES_PRINCIPAL_KEY,
  hasPrincipalDrafts,
  publishNotesPrincipal,
  readSessionPrincipal,
} from './notes-principal';

/** Root lifetime: private recovery outlives rooms, but never the authenticated account. */
export function RoundNotesPrivacy({
  principalId,
}: {
  readonly principalId: string | null | undefined;
}) {
  const [cleanupFailed, setCleanupFailed] = useState(false);
  useEffect(() => {
    // An unavailable server identity is not evidence of logout. The server's
    // identity already covers this mount; never refresh a fresh session here.
    if (principalId === undefined) return;
    let observed = principalId;
    let live = true;
    let pending: AbortController | null = null;
    const syncPrincipal = (next: string | null) => {
      if (next !== observed) {
        pending?.abort();
        pending = null;
        observed = next;
      }
      setCleanupFailed(!publishNotesPrincipal(next));
    };
    syncPrincipal(principalId);
    const check = async () => {
      if (!live || pending !== null || observed === null) return;
      try {
        if (hasPrincipalDrafts(window.localStorage, observed) === false) return;
      } catch {
        // A denied storage getter cannot establish that no private copy exists.
      }
      const controller = new AbortController();
      pending = controller;
      try {
        const response = await fetch('/api/auth/get-session', {
          cache: 'no-store',
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15_000),
          ]),
        });
        if (!response.ok) return;
        const next = readSessionPrincipal(await response.json());
        if (
          live &&
          pending === controller &&
          !controller.signal.aborted &&
          next !== undefined
        )
          syncPrincipal(next);
      } catch {
        // Offline or cancelled transport never establishes identity loss.
      } finally {
        if (pending === controller) pending = null;
      }
    };
    const visible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === NOTES_PRINCIPAL_KEY)
        syncPrincipal(event.newValue || null);
    };
    window.addEventListener('focus', check);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visible);
    return () => {
      live = false;
      pending?.abort();
      window.removeEventListener('focus', check);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [principalId]);
  return cleanupFailed ? (
    <p role="alert" className="px-4 py-2 text-sm text-live">
      Private note cleanup could not finish. Clear this site&apos;s storage
      before sharing this browser.
    </p>
  ) : null;
}
