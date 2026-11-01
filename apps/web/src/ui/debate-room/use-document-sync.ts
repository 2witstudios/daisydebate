'use client';

import { useEffect, useState, type Dispatch } from 'react';
import type { DocumentSync } from './document-sync';
import type { RoomAction } from './room-state';

/**
 * Loads the server's documents into the room, and saves any edits still
 * waiting when the page is hidden or the room closes.
 */
export function useDocumentSync(
  sync: DocumentSync | undefined,
  dispatch: Dispatch<RoomAction>,
) {
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    if (!sync) return;
    let live = true;
    sync
      .load()
      .then((documents) => {
        if (!live) return;
        dispatch({ type: 'doc/loaded', documents });
        dispatch({ type: 'doc/recovered', recovered: sync.recoveredDrafts() });
      })
      .catch(() => {
        if (live) setProblem('Your files did not load. Reload the page.');
      });
    const flush = () => void sync.flushKeepalive();
    window.addEventListener('pagehide', flush);
    return () => {
      live = false;
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [sync, dispatch]);
  return { problem, setProblem };
}
