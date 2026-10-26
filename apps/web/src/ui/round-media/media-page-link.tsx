import type { ComponentProps } from 'react';

/**
 * A link into a media page. A plain anchor, never next/link: the page must
 * arrive as a document load, because Permissions-Policy binds to the document
 * and a client-side entry keeps the previous page's camera and microphone
 * deny (ISSUE-564).
 */
export function MediaPageLink(
  props: ComponentProps<'a'> & { readonly href: string },
) {
  return <a {...props} />;
}
