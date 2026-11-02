/** A save failed in a way that may pass later; the sync is retrying it. */
export const RETRYING_NOTICE =
  'Your latest changes are not saved yet. Retrying.';

/** What the debater can do about a save the server refused for good. */
export function refusedNotice(status: number): string {
  if (status === 400 || status === 413 || status === 422)
    return 'This file is too large to save. Shorten it.';
  if (status === 401) return 'Sign in again to save your changes.';
  if (status === 403)
    return 'This file can’t be saved with your current access. Your text stays here.';
  return 'This file can no longer be saved. Reload the page.';
}
