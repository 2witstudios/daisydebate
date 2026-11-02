'use client';

import { useEffect, useState, type Dispatch } from 'react';
import type { DocumentSync } from './document-sync';
import { systemClock } from '@daisy/clock';
import { isNoteDraftKey } from './note-draft-storage';
import { closedFilesNotice } from './save-notice';
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
      })
      .catch(() => {
        if (live) setProblem('Your files did not load. Reload the page.');
      });
    const unsubscribe = sync.subscribe(() => {
      if (!live || sync.available()) return;
      dispatch({ type: 'doc/loaded', documents: [] });
      setProblem(closedFilesNotice(sync.closedBy()));
    });
    const adopted = sync.subscribeServerText((id, html) => {
      if (live)
        dispatch({ type: 'doc/update', id, html, now: systemClock.now() });
    });
    const refresh = (event: StorageEvent) => {
      if (event.key === null || isNoteDraftKey(event.key))
        sync.refreshRecovery();
    };
    window.addEventListener('storage', refresh);
    const flush = () => void sync.flushKeepalive();
    window.addEventListener('pagehide', flush);
    return () => {
      live = false;
      unsubscribe();
      adopted();
      window.removeEventListener('storage', refresh);
      window.removeEventListener('pagehide', flush);
      void sync.flush();
    };
  }, [sync, dispatch]);
  return { problem, setProblem };
}
