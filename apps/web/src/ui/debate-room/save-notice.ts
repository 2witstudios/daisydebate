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

/** Why this Round's files left the screen. A purge must not promise them back. */
export const closedFilesNotice = (
  reason: 'released' | 'fence' | 'purge' | null,
) =>
  reason === 'purge'
    ? 'This Round’s files are closed. Reopen the Round to load them.'
    : 'Your session ended. Sign in and reopen the Round to get your notes back.';
