import {
  NOTES_ERASED_COOKIE,
  notesErasedCookie,
} from '../../features/account/data-rights/notices-keys';
import {
  isPrincipalDraftKey,
  noteDraftKeys,
  type DraftStorage,
} from './note-draft-storage';

export const NOTES_PRINCIPAL_KEY = 'daisy:round-notes:principal';
export const NOTES_PRINCIPAL_EVENT = 'daisy:round-notes:principal-changed';
/** The session ended without proof of who is next: stop and hide, keep the copies. */
export const NOTES_FENCE_EVENT = 'daisy:round-notes:fence';
/** Something suggests the identity changed; only the session read may decide. */
export const NOTES_IDENTITY_CHECK_EVENT = 'daisy:round-notes:check-identity';
/** Survives the sign-out form's navigation, so only a real sign-out purges. */
export const NOTES_SIGN_OUT_INTENT_KEY = 'daisy:round-notes:sign-out-intent';

/** Identity markers only remove local data; they never authorize a document request. */
export function retainPrincipalDrafts(
  storage: DraftStorage,
  principalId: string | null,
) {
  try {
    for (const key of noteDraftKeys(storage))
      if (principalId === null || !isPrincipalDraftKey(key, principalId))
        storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** Notify active owners before erasing, so late callbacks cannot recreate private copies. */
export function publishNotesPrincipal(
  principalId: string | null,
  events: EventTarget,
  browserStorage: () => DraftStorage,
) {
  events.dispatchEvent(
    new CustomEvent(NOTES_PRINCIPAL_EVENT, { detail: principalId }),
  );
  let storage: DraftStorage;
  try {
    storage = browserStorage();
  } catch {
    // Denied storage holds nothing this browser can reach or erase.
    return true;
  }
  const cleared = retainPrincipalDrafts(storage, principalId);
  try {
    // Notify other tabs even when this tab could not remove a stored record.
    storage.setItem(NOTES_PRINCIPAL_KEY, principalId ?? '');
  } catch {
    // The cross-tab notice is separate from whether this cleanup succeeded.
  }
  return cleared;
}

/** Read-only input from the published session response; malformed data cannot change identity. */
export function readSessionPrincipal(
  value: unknown,
): string | null | undefined {
  if (value === null) return null;
  if (
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Object.hasOwn(value, 'user')
  )
    return undefined;
  const user = (value as { readonly user: unknown }).user;
  if (
    typeof user !== 'object' ||
    user === null ||
    Array.isArray(user) ||
    !Object.hasOwn(user, 'id')
  )
    return undefined;
  const id = (user as { readonly id: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/** Retained recovery copies count, including offers not queued for saving. Unknown storage is not proof of absence. */
export function hasPrincipalDrafts(
  storage: DraftStorage,
  principalId: string,
): boolean | null {
  try {
    return noteDraftKeys(storage).some((key) =>
      isPrincipalDraftKey(key, principalId),
    );
  } catch {
    return null;
  }
}

/** What the root does on a server-rendered mount. Only proof of a change purges. */
export const rootMountAction = (
  principalId: string | null,
  signOutIntent: boolean,
): 'publish' | 'keep' =>
  principalId !== null || signOutIntent ? 'publish' : 'keep';

/** The server's word that this browser asked to close its account. A denied cookie is no word. */
export function takeNotesErasedCookie(document: { cookie: string }): boolean {
  try {
    if (!document.cookie.split('; ').includes(`${NOTES_ERASED_COOKIE}=1`))
      return false;
    document.cookie = notesErasedCookie('', 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Keeping another account's copies says nothing about ones a purge failed to
 * remove, so only a purge that succeeds can clear the warning.
 */
export const cleanupFailedAfter = (
  failed: boolean,
  published: string | null,
  cleared: boolean,
) => (published === null ? !cleared : failed || !cleared);

export const isSignOutPath = (pathname: string) =>
  pathname === '/auth/sign-out';

/** A session answer matters only with an identity left to lose and copies at stake. Unknown storage is not proof of absence. */
export function needsSessionRead(
  storage: DraftStorage,
  observed: string | null | undefined,
): boolean {
  if (observed === null) return false;
  if (observed !== undefined)
    return hasPrincipalDrafts(storage, observed) !== false;
  try {
    return noteDraftKeys(storage).length > 0;
  } catch {
    return true;
  }
}
