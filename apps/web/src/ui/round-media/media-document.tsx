'use client';

import { useEffect } from 'react';
import { mediaDocumentStale } from '../../features/round-media/browser-policy';
import { browserDocument } from './browser-document';

/**
 * Reloads a media page that some client-side navigation reached from a
 * non-media document, so the page runs under its own Permissions-Policy
 * rather than the camera and microphone deny it inherited (ISSUE-564).
 */
export function MediaDocument() {
  useEffect(() => {
    if (mediaDocumentStale(browserDocument().url, window.location.pathname))
      window.location.reload();
  }, []);
  return null;
}
