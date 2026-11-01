'use client';

import { systemClock } from '@daisy/clock';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { SaveState } from './document-pane';
import { tabConnection } from '../../features/realtime/browser-adapters';
import { createDocumentsApi } from './documents-api';
import {
  createDocumentSync,
  type DocumentSync,
  type DocumentSyncResources,
  type DocumentsApi,
  type DraftStorage,
  type Timers,
} from './document-sync';
import { createKeepaliveBudget } from './keepalive-budget';
import {
  NOTES_PRINCIPAL_EVENT,
  publishNotesPrincipal,
} from './notes-principal';
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
  | { readonly type: 'refused'; readonly status: number }
  | { readonly type: 'unsaved' }
  | { readonly type: 'recovered' };

export const initialSaveStatus: SaveStatus = { save: 'saved', notice: null };

/** One browser page's shared keepalive body budget across every Round owner. */
const browserKeepaliveBudget = createKeepaliveBudget();

const browserTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const browserStorage = (): DraftStorage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** The browser edge supplies every effect; all owners share this page's ledger. */
export const browserNoteResources = (): DocumentSyncResources => ({
  timers: browserTimers,
  storage: browserStorage(),
  budget: browserKeepaliveBudget,
  wallClock: () => Date.parse(systemClock.now()),
});

const CONFLICT_NOTICE =
  'This file changed in another tab. Reload before editing it again.';

/** One saving event's effect on the room's save status. */
export function reduceSave(status: SaveStatus, event: SaveEvent): SaveStatus {
  switch (event.type) {
    case 'recovered':
      return {
        save: 'unsaved',
        notice:
          'An unsaved draft is available. Restore, copy or discard it below.',
      };
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
    case 'unsaved':
      return {
        save: 'unsaved',
        notice: 'Storage is unavailable; your latest changes are not saved.',
      };
  }
}

/** The Round's document sync, reporting every saving event it sees. */
export function roundSync(
  roundId: string,
  principalId: string,
  api: DocumentsApi,
  report: (event: SaveEvent) => void,
  resources: DocumentSyncResources,
): DocumentSync {
  const stored = createDocumentSync({
    roundId,
    principalId,
    api,
    ...resources,
    onChanged: () => report({ type: 'edit' }),
    onConflict: () => report({ type: 'conflict' }),
    onSaveFailed: () => report({ type: 'retrying' }),
    onSaveRefused: (_id, status) => {
      if (status === 401 || status === 403) {
        stored.dispose({ purge: true });
        if (typeof window !== 'undefined') publishNotesPrincipal(null);
      }
      report({ type: 'refused', status });
    },
    onRecoveredDraft: () => report({ type: 'recovered' }),
    onDraftStorageFailed: () => report({ type: 'unsaved' }),
    onSaved: () => report({ type: 'saved' }),
  });
  return stored;
}

/** A participant's files on the persisted Round's document API. */
export function useRoundSync(
  roundId: string,
  principalId: string,
  socketUrl: string | null = null,
): SaveStatus & {
  readonly sync: DocumentSync;
} {
  const [status, report] = useReducer(reduceSave, initialSaveStatus);
  const sync = useMemo(
    () =>
      roundSync(
        roundId,
        principalId,
        createDocumentsApi(),
        report,
        browserNoteResources(),
      ),
    [roundId, principalId],
  );
  useEffect(() => {
    if (socketUrl === null) return;
    const connection = tabConnection(socketUrl);
    const stop = connection.subscribe((state) => {
      if (state.terminal === 'revoked' || state.terminal === 'signed-out') {
        sync.dispose({ purge: true });
        publishNotesPrincipal(null);
      }
    });
    connection.connect();
    return () => {
      stop();
      connection.dispose();
    };
  }, [sync, socketUrl]);
  const lifetime = useRef({ sync });
  useEffect(() => {
    const token = { sync };
    lifetime.current = token;
    const changed = (event: Event) => {
      if ((event as CustomEvent<unknown>).detail !== principalId)
        sync.dispose({ purge: true });
    };
    window.addEventListener(NOTES_PRINCIPAL_EVENT, changed);
    return () => {
      // Strict Mode reattaches the same owner in this turn. A real unmount
      // drains normal saves while the identity listener still fences it.
      queueMicrotask(() => {
        const remove = () =>
          window.removeEventListener(NOTES_PRINCIPAL_EVENT, changed);
        if (lifetime.current !== token && lifetime.current.sync === sync)
          return remove();
        if (lifetime.current.sync !== sync) {
          sync.dispose({ purge: true });
          return remove();
        }
        void sync.flush().finally(() => {
          sync.dispose();
          remove();
        });
      });
    };
  }, [sync, principalId]);
  return { sync, ...status };
}
