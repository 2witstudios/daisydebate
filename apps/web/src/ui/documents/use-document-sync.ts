'use client';

import { useResource } from '../edge/use-driver';
import { useLatest } from '../edge/use-latest';
import { useState, type Dispatch } from 'react';
import { flushSync } from 'react-dom';
import type { DocumentSync } from './document-sync';
import { systemClock } from '@daisy/clock';
import { isDraftKey } from './document-draft-storage';
import { closedFilesNotice } from './save-notice';
import type { ManagerAction } from '../../features/documents/document-manager-state';

type SyncOwner = {
  readonly dispatch: Dispatch<ManagerAction>;
  readonly setProblem: (problem: string) => void;
  readonly openIds: () => readonly string[];
};

/**
 * One owner's hold on the document sync: loads its documents, follows the
 * server's text and withdrawals, rechecks on focus, guards an exit that
 * would lose text, and saves whatever is still waiting when it is let go.
 */
function attachDocumentSync(
  sync: DocumentSync,
  { dispatch, setProblem, openIds }: SyncOwner,
) {
  let live = true;
  // Whatever this owner still holds saves first, so a read never shows older
  // text than the person typed when the frame around it changes.
  sync
    .flush()
    .then(() => sync.load())
    .then((documents) => {
      if (!live) return;
      dispatch({ type: 'doc/loaded', documents });
    })
    .catch(() => {
      if (live) setProblem('Your documents did not load. Reload the page.');
    });
  const unsubscribe = sync.subscribe(() => {
    if (!live || sync.available()) return;
    dispatch({ type: 'doc/withdrawn' });
    setProblem(closedFilesNotice(sync.closedBy()));
  });
  const adopted = sync.subscribeServerText((id, html) => {
    // In this same task as the revision moving, so no keystroke can land on
    // the old text with the new revision.
    if (live)
      flushSync(() =>
        dispatch({
          type: 'doc/server-text',
          id,
          html,
          now: systemClock.now(),
        }),
      );
  });
  const refresh = (event: StorageEvent) => {
    if (event.key === null || isDraftKey(event.key)) sync.refreshRecovery();
  };
  // A document deleted in another tab or device shows when this one is next
  // looked at, as well as at its next save.
  const recheck = () => void sync.recheck(openIds());
  // Text with no stored copy and no server copy: a reload would lose it, so ask.
  const guardExit = (event: BeforeUnloadEvent) => {
    if (sync.holdsAnyUnstored()) event.preventDefault();
  };
  window.addEventListener('beforeunload', guardExit);
  window.addEventListener('focus', recheck);
  window.addEventListener('storage', refresh);
  const flush = () => void sync.flushKeepalive();
  window.addEventListener('pagehide', flush);
  return {
    dispose: () => {
      live = false;
      unsubscribe();
      adopted();
      window.removeEventListener('beforeunload', guardExit);
      window.removeEventListener('focus', recheck);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('pagehide', flush);
      void sync.flush();
    },
  };
}

/**
 * Loads the server's documents into the room, and saves any edits still
 * waiting when the page is hidden or the room closes.
 */
export function useDocumentSync(
  sync: DocumentSync | undefined,
  dispatch: Dispatch<ManagerAction>,
  openIds: readonly string[] = [],
) {
  const [problem, setProblem] = useState<string | null>(null);
  const open = useLatest(openIds);
  useResource(sync ?? null, (held) =>
    held === null
      ? null
      : attachDocumentSync(held, {
          dispatch,
          setProblem,
          openIds: open,
        }),
  );
  return { problem, setProblem };
}
