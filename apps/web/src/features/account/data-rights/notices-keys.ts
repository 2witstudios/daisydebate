/**
 * The fixed query keys the data-rights handlers answer with. The pages
 * compare these with === and render fixed sentences; no form value ever
 * travels in a URL (UI conventions, ISSUE-18's no-JS rule).
 */
export const EXPORT_DATA_QUERY = 'privacyExport';
export const ERASE_ACCOUNT_QUERY = 'privacyErase';
export const ACCOUNT_CLOSED_QUERY = 'closed';
/**
 * Set only when this browser confirmed closing its account, so its private note
 * copies are erased on the server's word. Holds no identity, and script reads it.
 */
export const DRAFTS_ERASED_COOKIE = 'daisy-notes-erased';
export const draftsErasedCookie = (value: string, maxAgeSeconds: number) =>
  `${DRAFTS_ERASED_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax; Secure`;
