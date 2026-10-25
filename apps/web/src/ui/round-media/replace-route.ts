import { mediaDocumentStale } from '../../features/round-media/browser-policy';

/**
 * Replaces the current route through the client router, except that a media
 * page this document lacks the policy for arrives as a document load, so its
 * own Permissions-Policy applies (ISSUE-564).
 */
export function replaceRoute(
  router: { readonly replace: (href: string) => void },
  document: {
    readonly url: string | undefined;
    readonly replace: (href: string) => void;
  },
  href: string,
): void {
  if (mediaDocumentStale(document.url, href)) document.replace(href);
  else router.replace(href);
}
