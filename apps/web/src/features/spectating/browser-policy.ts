const isBroadcastViewerPage = (path: string) => /^\/watch\/[^/]+$/.test(path);

/**
 * The origin the Round page may play from; null anywhere else and on a value
 * that is not a plain origin, so the strict policy stands for every other page.
 */
export const broadcastPlaybackOrigin = (
  path: string,
  origin: string | null | undefined,
): string | null => {
  if (!isBroadcastViewerPage(path) || !origin) return null;
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
};

/**
 * A CSP binds to the document, so the Round page reached by client-side
 * navigation keeps the policy of the page the document was loaded as, and that
 * policy refuses the feed. True when `path` is the Round page and the document
 * was not; an unknown document URL is never stale, so a reload cannot loop.
 */
export const broadcastDocumentStale = (
  documentUrl: string | undefined,
  path: string,
): boolean =>
  documentUrl !== undefined &&
  isBroadcastViewerPage(path) &&
  !isBroadcastViewerPage(
    new URL(documentUrl, 'https://daisy.invalid').pathname,
  );
