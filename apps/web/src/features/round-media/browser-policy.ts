/** Feature pages only: API, documents and spectator routes receive no capture exception. */
export const roundMediaPages = [
  '/rooms/:id',
  '/rounds/:id',
  '/rounds/:id/room',
] as const;
const isRoundMediaPage = (path: string) =>
  /^\/(rooms\/[^/]+|rounds\/[^/]+(?:\/room)?)$/.test(path);

/** Whether an in-app href, query and hash aside, lands on a media page. */
export const isRoundMediaHref = (href: string): boolean =>
  isRoundMediaPage(new URL(href, 'https://daisy.invalid').pathname);

/**
 * Permissions-Policy binds to the document, so a media page reached by
 * client-side navigation keeps the policy of the page the document was
 * loaded as (ISSUE-564). True when `href` is a media page and that page was
 * not; an unknown document URL is never stale, so a reload cannot loop.
 */
export const mediaDocumentStale = (
  documentUrl: string | undefined,
  href: string,
): boolean =>
  documentUrl !== undefined &&
  isRoundMediaHref(href) &&
  !isRoundMediaHref(documentUrl);

export function roundMediaOrigins(
  path: string,
  endpoint: string | null | undefined,
  development: boolean,
): readonly string[] {
  if (!isRoundMediaPage(path) || !endpoint) return [];
  try {
    const url = new URL(endpoint);
    if (
      url.username ||
      url.password ||
      !['wss:', ...(development ? ['ws:'] : [])].includes(url.protocol)
    )
      return [];
    const websocket = url.origin;
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    return [websocket, url.origin];
  } catch {
    return [];
  }
}
