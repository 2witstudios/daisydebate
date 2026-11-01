import { draftKeys, type DraftStorage } from './document-sync';

export const NOTES_PRINCIPAL_KEY = 'daisy:round-notes:principal';
export const NOTES_PRINCIPAL_EVENT = 'daisy:round-notes:principal-changed';

/** Identity markers only remove local data; they never authorize a document request. */
export function retainPrincipalDrafts(
  storage: DraftStorage,
  principalId: string | null,
) {
  for (const key of draftKeys.getAll(storage))
    if (
      principalId === null ||
      !key.startsWith(`daisy:round-notes:draft:${principalId}:`)
    )
      storage.removeItem(key);
}

/** Notify active owners before erasing, so late callbacks cannot recreate private copies. */
export function publishNotesPrincipal(principalId: string | null) {
  window.dispatchEvent(
    new CustomEvent(NOTES_PRINCIPAL_EVENT, { detail: principalId }),
  );
  try {
    retainPrincipalDrafts(window.localStorage, principalId);
    window.localStorage.setItem(NOTES_PRINCIPAL_KEY, principalId ?? '');
  } catch {
    // A browser that denies storage has no accessible recovery store to purge.
  }
}
