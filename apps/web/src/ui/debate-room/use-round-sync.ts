'use client';

import { useMemo, useReducer } from 'react';
import type { SaveState } from './document-pane';
import { createDocumentsApi } from './documents-api';
import {
  createDocumentSync,
  type DocumentSync,
  type DocumentsApi,
  type Timers,
} from './document-sync';
import { refusedNotice, RETRYING_NOTICE } from './save-notice';

/** What the room says about saving: the saved state and a standing notice. */
export type SaveStatus = {
  readonly save: SaveState;
  readonly notice: string | null;
};

export type SaveEvent =
  | { readonly type: 'edit' }
  | { readonly type: 'saved' }
  | { readonly type: 'conflict' }
  | { readonly type: 'retrying' }
  | { readonly type: 'refused'; readonly status: number };

export const initialSaveStatus: SaveStatus = { save: 'saved', notice: null };

const CONFLICT_NOTICE =
  'This file changed in another tab. Reload before editing it again.';

/** One saving event's effect on the room's save status. */
export function reduceSave(status: SaveStatus, event: SaveEvent): SaveStatus {
  switch (event.type) {
    case 'edit':
      return { ...status, save: 'saving' };
    case 'saved':
      return initialSaveStatus;
    case 'conflict':
      return { save: 'unsaved', notice: CONFLICT_NOTICE };
    case 'retrying':
      return { save: 'unsaved', notice: RETRYING_NOTICE };
    case 'refused':
      return { save: 'unsaved', notice: refusedNotice(event.status) };
  }
}

/** The Round's document sync, reporting every saving event it sees. */
export function roundSync(
  roundId: string,
  api: DocumentsApi,
  report: (event: SaveEvent) => void,
  timers?: Timers,
): DocumentSync {
  const stored = createDocumentSync({
    roundId,
    api,
    onConflict: () => report({ type: 'conflict' }),
    onSaveFailed: () => report({ type: 'retrying' }),
    onSaveRefused: (_id, status) => report({ type: 'refused', status }),
    onSaved: () => report({ type: 'saved' }),
    ...(timers ? { timers } : {}),
  });
  return {
    ...stored,
    change: (id, html) => {
      report({ type: 'edit' });
      stored.change(id, html);
    },
  };
}

/** A participant's files on the persisted Round's document API. */
export function useRoundSync(roundId: string): SaveStatus & {
  readonly sync: DocumentSync;
} {
  const [status, report] = useReducer(reduceSave, initialSaveStatus);
  const sync = useMemo(
    () => roundSync(roundId, createDocumentsApi(), report),
    [roundId],
  );
  return { sync, ...status };
}
