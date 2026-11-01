import { draftKeys, type DraftStorage } from './document-sync';

export const NOTES_PRINCIPAL_KEY = 'daisy:round-notes:principal';
export const NOTES_PRINCIPAL_EVENT = 'daisy:round-notes:principal-changed';

/** Identity markers only remove local data; they never authorize a document request. */
export function retainPrincipalDrafts(
  storage: DraftStorage,
  principalId: string | null,
) {
  try {
    for (const key of draftKeys.getAll(storage))
      if (
        principalId === null ||
        !key.startsWith(`daisy:round-notes:draft:${principalId}:`)
      )
        storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** Notify active owners before erasing, so late callbacks cannot recreate private copies. */
export function publishNotesPrincipal(principalId: string | null) {
  window.dispatchEvent(
    new CustomEvent(NOTES_PRINCIPAL_EVENT, { detail: principalId }),
  );
  let cleared = false;
  try {
    cleared = retainPrincipalDrafts(window.localStorage, principalId);
  } catch {
    // Even obtaining the storage object can be denied by the browser.
  }
  try {
    // Notify other tabs even when this tab could not remove a stored record.
    window.localStorage.setItem(NOTES_PRINCIPAL_KEY, principalId ?? '');
  } catch {
    return false;
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
    return draftKeys
      .getAll(storage)
      .some((key) => key.startsWith(`daisy:round-notes:draft:${principalId}:`));
  } catch {
    return null;
  }
}
