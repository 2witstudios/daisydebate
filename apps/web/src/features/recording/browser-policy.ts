const isReplayPage = (path: string) => /^\/recordings\/[^/]+$/.test(path);

/**
 * The bucket origin the replay page may read a signed media URL from; null
 * anywhere else and on a value that is not a plain origin, so the strict policy
 * stands for every other page.
 */
export const recordingPlaybackOrigin = (
  path: string,
  origin: string | null | undefined,
): string | null => {
  if (!isReplayPage(path) || !origin) return null;
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
};

/**
 * A CSP binds to the document, so a replay page reached by client-side navigation
 * keeps the policy of the page the document was loaded as, and that policy
 * refuses the video. An unknown document URL is never stale, so no reload can loop.
 */
export const recordingDocumentStale = (
  documentUrl: string | undefined,
  path: string,
): boolean =>
  documentUrl !== undefined &&
  isReplayPage(path) &&
  !isReplayPage(new URL(documentUrl, 'https://daisy.invalid').pathname);
