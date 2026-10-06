/** A save failed in a way that may pass later; the sync is retrying it. */
export const RETRYING_NOTICE =
  'Your latest changes are not saved yet. Retrying.';

/** Another tab saved the file first; the debater's copy is still on screen. */
export const CONFLICT_NOTICE =
  'This file changed in another tab. Copy your changes, then reload the page.';

/** What the debater can do about a save the server refused for good. */
export function refusedNotice(status: number): string {
  if (status === 400 || status === 413 || status === 422)
    return 'This file is too large to save. Shorten it.';
  if (status === 401 || status === 403)
    return 'Sign in again to save your changes.';
  return 'This file can no longer be saved. Reload the page.';
}
