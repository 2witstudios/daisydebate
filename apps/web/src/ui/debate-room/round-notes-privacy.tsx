'use client';

import { useEffect, useState } from 'react';
import { systemClock } from '@daisy/clock';
import { pruneExpiredNoteDrafts } from './note-draft-storage';
import {
  NOTES_FENCE_EVENT,
  NOTES_IDENTITY_CHECK_EVENT,
  NOTES_PRINCIPAL_KEY,
  NOTES_SIGN_OUT_INTENT_KEY,
  hasPrincipalDrafts,
  endsAccountSession,
  publishNotesPrincipal,
  readSessionPrincipal,
  rootMountAction,
} from './notes-principal';

const browserStorage = (read: () => Storage) => {
  try {
    return read();
  } catch {
    return null;
  }
};

/** Retention is enforced for every visitor, whichever Round they reopen. */
const pruneExpired = () => {
  const storage = browserStorage(() => window.localStorage);
  if (!storage) return;
  try {
    pruneExpiredNoteDrafts(storage, Date.parse(systemClock.now()));
  } catch {
    // Reads and writes re-check expiry; a denied prune never blocks a page.
  }
};

const takeSignOutIntent = () => {
  const storage = browserStorage(() => window.sessionStorage);
  try {
    const intent = storage?.getItem(NOTES_SIGN_OUT_INTENT_KEY) === 'yes';
    storage?.removeItem(NOTES_SIGN_OUT_INTENT_KEY);
    return intent;
  } catch {
    return false;
  }
};

const markSignOutIntent = (event: Event) => {
  if (!(event.target instanceof HTMLFormElement)) return;
  const { pathname } = new URL(event.target.action, window.location.href);
  if (!endsAccountSession(pathname)) return;
  try {
    browserStorage(() => window.sessionStorage)?.setItem(
      NOTES_SIGN_OUT_INTENT_KEY,
      'yes',
    );
  } catch {
    // Without the mark the copies stay hidden until their own expiry.
  }
};

/**
 * Root lifetime: private recovery outlives rooms and an expired session, but
 * never an explicit sign-out or a different account. An anonymous page is not
 * proof of sign-out, so it keeps the copies, hidden, for the same person.
 */
export function RoundNotesPrivacy({
  principalId,
}: {
  readonly principalId: string | null | undefined;
}) {
  const [cleanupFailed, setCleanupFailed] = useState(false);
  useEffect(() => {
    pruneExpired();
    document.addEventListener('submit', markSignOutIntent, { capture: true });
    return () =>
      document.removeEventListener('submit', markSignOutIntent, {
        capture: true,
      });
  }, []);
  useEffect(() => {
    // An unavailable server identity is not evidence of logout, so this mount
    // publishes nothing, yet still listens for changes from other tabs.
    let observed: string | null | undefined = principalId;
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
    const fence = () => window.dispatchEvent(new Event(NOTES_FENCE_EVENT));
    if (
      principalId !== undefined &&
      rootMountAction(principalId, takeSignOutIntent()) === 'publish'
    )
      syncPrincipal(principalId);
    const read = async () => {
      if (!live || pending !== null || observed === null) return;
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
        ) {
          // A signed-out session only fences: expiry is not a sign-out.
          if (next === null) fence();
          else syncPrincipal(next);
        }
      } catch {
        // Offline or cancelled transport never establishes identity loss.
      } finally {
        if (pending === controller) pending = null;
      }
    };
    const check = async () => {
      if (observed === null) return;
      try {
        if (
          observed !== undefined &&
          hasPrincipalDrafts(window.localStorage, observed) === false
        )
          return;
      } catch {
        // A denied storage getter cannot establish that no private copy exists.
      }
      await read();
    };
    const visible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === NOTES_PRINCIPAL_KEY)
        syncPrincipal(event.newValue || null);
    };
    window.addEventListener('focus', check);
    window.addEventListener(NOTES_IDENTITY_CHECK_EVENT, read);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visible);
    return () => {
      live = false;
      pending?.abort();
      window.removeEventListener('focus', check);
      window.removeEventListener(NOTES_IDENTITY_CHECK_EVENT, read);
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
