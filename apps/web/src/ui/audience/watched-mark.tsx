'use client';
import {
  browserTransport,
  type BrowserTransport,
} from '../edge/browser-request';
import { useDeliver } from '../edge/use-answer';

const markWatched = (fetch: BrowserTransport, roundId: string) =>
  void fetch('/api/watch-history', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: 1, kind: 'watched', roundId }),
  }).catch(() => undefined);

/**
 * Adds this Round to a signed-in viewer's watch history, once per mount. It is
 * mounted only for an account. A failure costs one history row and nothing else.
 */
export function WatchedMark({ roundId }: { readonly roundId: string }) {
  useDeliver(roundId, (watched) => markWatched(browserTransport, watched));
  return null;
}
