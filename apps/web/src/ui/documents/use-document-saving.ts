'use client';

import { systemClock, systemId } from '@daisy/clock';
import { useEffect, useMemo, useReducer, useRef } from 'react';
import type { SaveState } from './document-pane';
import { tabConnection } from '../../features/realtime/browser-adapters';
import { createDocumentsApi } from './documents-api';
import {
  createDocumentSync,
  type DocumentSync,
  type DocumentSyncResources,
  type DocumentsApi,
  type Timers,
} from './document-sync';
import type { DraftStorage } from './document-draft-storage';
import { releaseDraftOwner } from './draft-owner';
import { createKeepaliveBudget } from './keepalive-budget';
import {
  DRAFTS_FENCE_EVENT,
  DRAFTS_IDENTITY_CHECK_EVENT,
  DRAFTS_PRINCIPAL_EVENT,
} from './draft-principal';
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
export const browserDraftResources = (): DocumentSyncResources => ({
  nextGeneration: () => systemId.next(),
  timers: browserTimers,
  storage: browserStorage(),
  budget: browserKeepaliveBudget,
  wallClock: () => Date.parse(systemClock.now()),
});

const CONFLICT_NOTICE =
  'A newer save of this file arrived. Reload before editing it again.';

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
        notice:
          'Storage is unavailable for recovery. Keep this page open until your edits save online.',
      };
  }
}

/** The Round's document sync, reporting every saving event it sees. */
export function documentSaving(
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
      // An expired session stops and hides the drafts but keeps their copies for
      // the same person. A 403 is not about identity, so nothing is withdrawn.
      if (status === 401) stored.fence();
      report({ type: 'refused', status });
    },
    onRecoveryChanged: () => report({ type: 'recovered' }),
    onDraftStorageFailed: () => report({ type: 'unsaved' }),
    onSaved: () => report({ type: 'saved' }),
  });
  return stored;
}

/** A participant's files on the persisted Round's document API. */
export function useDocumentSaving(
  roundId: string,
  principalId: string,
  socketUrl: string | null = null,
): SaveStatus & {
  readonly sync: DocumentSync;
} {
  const [status, dispatch] = useReducer(reduceSave, initialSaveStatus);
  const sync = useMemo(
    () =>
      documentSaving(
        roundId,
        principalId,
        createDocumentsApi(),
        (event) => {
          dispatch(event);
          if (event.type === 'refused' && event.status === 401)
            window.dispatchEvent(new Event(DRAFTS_IDENTITY_CHECK_EVENT));
        },
        browserDraftResources(),
      ),
    [roundId, principalId],
  );
  useEffect(() => {
    if (socketUrl === null) return;
    const connection = tabConnection(socketUrl);
    const stop = connection.subscribe((state) => {
      // A socket can close this way on a transient failure, so it only asks.
      if (state.terminal === 'revoked' || state.terminal === 'signed-out')
        window.dispatchEvent(new Event(DRAFTS_IDENTITY_CHECK_EVENT));
    });
    connection.connect();
    return () => {
      stop();
      connection.dispose();
    };
  }, [sync, socketUrl]);
  const lifetime = useRef({ sync, principalId });
  useEffect(() => {
    const token = { sync, principalId };
    lifetime.current = token;
    const changed = (event: Event) => {
      if ((event as CustomEvent<unknown>).detail !== principalId)
        sync.dispose({ purge: true });
    };
    const fenced = () => void sync.fence();
    window.addEventListener(DRAFTS_PRINCIPAL_EVENT, changed);
    window.addEventListener(DRAFTS_FENCE_EVENT, fenced);
    return () => {
      // Strict Mode reattaches the same owner in this turn. A real unmount
      // drains normal saves while the identity listener still fences it.
      queueMicrotask(() => {
        const remove = () => {
          window.removeEventListener(DRAFTS_PRINCIPAL_EVENT, changed);
          window.removeEventListener(DRAFTS_FENCE_EVENT, fenced);
        };
        void releaseDraftOwner(token, lifetime.current).finally(remove);
      });
    };
  }, [sync, principalId]);
  return { sync, ...status };
}
