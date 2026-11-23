'use client';

import { useNavigation } from '../edge/use-navigation';

import { mediaDocumentStale } from '../../features/round-media/browser-policy';
import { browserDocument } from './browser-document';

/**
 * Reloads a media page that some client-side navigation reached from a
 * non-media document, so the page runs under its own Permissions-Policy
 * rather than the camera and microphone deny it inherited (ISSUE-564).
 */
export function MediaDocument() {
  const stale =
    typeof window !== 'undefined' &&
    mediaDocumentStale(browserDocument().url, window.location.pathname);
  useNavigation(null, stale ? window.location.href : undefined, () =>
    window.location.reload(),
  );
  return null;
}
