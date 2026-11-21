'use client';
import { useBrowserEffect } from '../edge/browser-sync';
import { browserFetch } from '../edge/browser-request';

/**
 * Adds this Round to a signed-in viewer's watch history, once per mount. It is
 * mounted only for an account. A failure costs one history row and nothing else.
 */
export function WatchedMark({ roundId }: { readonly roundId: string }) {
  useBrowserEffect(() => {
    void browserFetch('/api/watch-history', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, kind: 'watched', roundId }),
    }).catch(() => undefined);
  }, [roundId]);
  return null;
}
