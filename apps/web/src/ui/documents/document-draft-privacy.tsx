'use client';

import { useEffect, useState } from 'react';
import { systemClock } from '@daisy/clock';
import { pruneExpiredDrafts } from './document-draft-storage';
import { watchDraftIdentity } from './draft-identity-watch';
import {
  DRAFTS_SIGN_OUT_INTENT_KEY,
  cleanupFailedAfter,
  isSignOutPath,
  publishDraftsPrincipal,
  takeDraftsErasedCookie,
} from './draft-principal';

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
    pruneExpiredDrafts(storage, Date.parse(systemClock.now()));
  } catch {
    // Reads and writes re-check expiry; a denied prune never blocks a page.
  }
};

const hasSignOutIntent = () => {
  try {
    return (
      browserStorage(() => window.sessionStorage)?.getItem(
        DRAFTS_SIGN_OUT_INTENT_KEY,
      ) === 'yes'
    );
  } catch {
    return false;
  }
};

const takeSignOutIntent = () => {
  const storage = browserStorage(() => window.sessionStorage);
  try {
    const intent = storage?.getItem(DRAFTS_SIGN_OUT_INTENT_KEY) === 'yes';
    storage?.removeItem(DRAFTS_SIGN_OUT_INTENT_KEY);
    return intent;
  } catch {
    return false;
  }
};

const markSignOutIntent = (event: Event) => {
  if (!(event.target instanceof HTMLFormElement)) return;
  const { pathname } = new URL(event.target.action, window.location.href);
  if (!isSignOutPath(pathname)) return;
  try {
    browserStorage(() => window.sessionStorage)?.setItem(
      DRAFTS_SIGN_OUT_INTENT_KEY,
      'yes',
    );
  } catch {
    // Without the mark the copies stay hidden until their own expiry.
  }
};

/**
 * Root lifetime: private recovery outlives rooms and an expired session, but
 * never an explicit sign-out, a closed account or a different account. An
 * anonymous page is not proof of sign-out, so it keeps the copies, hidden, for
 * the same person.
 */
export function DocumentDraftPrivacy({
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
  useEffect(
    () =>
      watchDraftIdentity(principalId, {
        events: window,
        visibility: document,
        storage: () => window.localStorage,
        fetchSession: (signal) =>
          fetch('/api/auth/get-session', {
            cache: 'no-store',
            signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
          }),
        hasSignOutIntent,
        takeSignOutIntent,
        takeAccountClosedProof: () => takeDraftsErasedCookie(document),
        publish: (next) => {
          const cleared = publishDraftsPrincipal(
            next,
            window,
            () => window.localStorage,
          );
          setCleanupFailed((failed) =>
            cleanupFailedAfter(failed, next, cleared),
          );
        },
      }),
    [principalId],
  );
  return cleanupFailed ? (
    <p role="alert" className="px-4 py-2 text-sm text-live">
      Private note cleanup could not finish. Clear this site&apos;s storage
      before sharing this browser.
    </p>
  ) : null;
}
