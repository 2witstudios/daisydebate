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

/** What stands against one document's save. */
type SaveWarning =
  | { readonly kind: 'retrying' }
  /** The draft could not be kept on this device. */
  | { readonly kind: 'storage' }
  | { readonly kind: 'refused'; readonly status: number }
  | { readonly kind: 'conflict'; readonly unstored: boolean }
  | { readonly kind: 'gone' };

/** A conflict or a deletion sends nothing, so neither is ever "saving". */
type CarriedWarning = Exclude<SaveWarning, { kind: 'conflict' | 'gone' }>;

/** One document that is not simply saved. */
type DocumentSave =
  | { readonly save: 'saving'; readonly warning: CarriedWarning | null }
  | { readonly save: 'unsaved'; readonly warning: SaveWarning };

/**
 * Every open document's save, each on its own, and the documents with a
 * recovered draft on offer. A document absent from `documents` is saved. The
 * room's one status is derived from this, never stored beside it.
 */
export type SavePage = {
  readonly documents: ReadonlyMap<string, DocumentSave>;
  readonly offered: readonly string[];
};

export type SaveEvent =
  | {
      readonly type: 'edit' | 'saved' | 'gone' | 'retrying' | 'unsaved';
      readonly documentId: string;
    }
  | {
      readonly type: 'conflict';
      readonly documentId: string;
      readonly unstored: boolean;
    }
  | {
      readonly type: 'refused';
      readonly documentId: string;
      readonly status: number;
    }
  /** The documents that now have a recovered draft on offer; none clears it. */
  | { readonly type: 'recovered'; readonly documentIds: readonly string[] };

export const initialSavePage: SavePage = { documents: new Map(), offered: [] };

/** One browser page's shared keepalive body budget across every owner. */
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

const GONE_NOTICE =
  'This document was deleted. Your text is kept here: save it as a new document to keep it.';

/** A reload would lose this text, so the way out is on the page. */
const CONFLICT_UNSTORED_NOTICE =
  'A newer save of this document arrived, and your latest typing is only on this page. Do not reload: save it as a new document below.';

const CONFLICT_NOTICE =
  'A newer save of this document arrived. Reload before editing it again.';

const RECOVERED_NOTICE =
  'An unsaved draft is available. Restore, copy or discard it below.';

const STORAGE_NOTICE =
  'Storage is unavailable for recovery. Keep this page open until your edits save online.';

const noticeOf = (warning: SaveWarning): string => {
  switch (warning.kind) {
    case 'conflict':
      return warning.unstored ? CONFLICT_UNSTORED_NOTICE : CONFLICT_NOTICE;
    case 'gone':
      return GONE_NOTICE;
    case 'refused':
      return refusedNotice(warning.status);
    case 'storage':
      return STORAGE_NOTICE;
    case 'retrying':
      return RETRYING_NOTICE;
  }
};

/** Which warning the room shows first: text a reload would lose outranks the rest. */
const severityOf = (warning: SaveWarning): number => {
  switch (warning.kind) {
    case 'conflict':
      return warning.unstored ? 6 : 4;
    case 'gone':
      return 5;
    case 'refused':
      return 3;
    case 'storage':
      return 2;
    case 'retrying':
      return 1;
  }
};

const carried = (warning: SaveWarning | null): CarriedWarning | null =>
  warning === null || warning.kind === 'conflict' || warning.kind === 'gone'
    ? null
    : warning;

/** One saving event's effect on the document it names, and on no other. */
export function reduceSave(page: SavePage, event: SaveEvent): SavePage {
  if (event.type === 'recovered')
    return { ...page, offered: event.documentIds };
  const documents = new Map(page.documents);
  const unsaved = (warning: SaveWarning): SavePage => ({
    ...page,
    documents: documents.set(event.documentId, { save: 'unsaved', warning }),
  });
  switch (event.type) {
    case 'saved':
      documents.delete(event.documentId);
      return { ...page, documents };
    case 'edit':
      return {
        ...page,
        documents: documents.set(event.documentId, {
          save: 'saving',
          warning: carried(documents.get(event.documentId)?.warning ?? null),
        }),
      };
    case 'conflict':
      return unsaved({ kind: 'conflict', unstored: event.unstored });
    case 'gone':
      return unsaved({ kind: 'gone' });
    case 'retrying':
      return unsaved({ kind: 'retrying' });
    case 'refused':
      return unsaved({ kind: 'refused', status: event.status });
    case 'unsaved':
      return unsaved({ kind: 'storage' });
  }
}

/**
 * The room's one status: not saved while any document is not, and the most
 * serious notice among them, so one document's save never hides another's
 * warning. A draft on offer keeps the room unsaved once nothing else does.
 */
export function saveStatusOf(page: SavePage): SaveStatus {
  const open = [...page.documents.values()];
  const [worst] = open
    .flatMap((document) => (document.warning ? [document.warning] : []))
    .sort((one, two) => severityOf(two) - severityOf(one));
  const offered = page.offered.length > 0;
  const idle: SaveState = offered ? 'unsaved' : 'saved';
  return {
    save: open.some((document) => document.save === 'unsaved')
      ? 'unsaved'
      : open.length > 0
        ? 'saving'
        : idle,
    notice: worst ? noticeOf(worst) : offered ? RECOVERED_NOTICE : null,
  };
}

/** A document sync's callbacks as saving events, each naming its document. */
export const savingReports = (
  report: (event: SaveEvent) => void,
  holdsUnstored: (documentId: string) => boolean,
) => ({
  onChanged: (documentId: string) => report({ type: 'edit', documentId }),
  onConflict: (documentId: string) =>
    report({
      type: 'conflict',
      documentId,
      unstored: holdsUnstored(documentId),
    }),
  onGone: (documentId: string) => report({ type: 'gone', documentId }),
  onSaveFailed: (documentId: string) =>
    report({ type: 'retrying', documentId }),
  onSaveRefused: (documentId: string, status: number) =>
    report({ type: 'refused', documentId, status }),
  onRecoveryChanged: (offers: readonly { readonly documentId: string }[]) =>
    report({
      type: 'recovered',
      documentIds: [...new Set(offers.map((offer) => offer.documentId))],
    }),
  onDraftStorageFailed: (documentId: string) =>
    report({ type: 'unsaved', documentId }),
  onSaved: (documentId: string) => report({ type: 'saved', documentId }),
});

/** The member's document sync, reporting every saving event it sees. */
export function documentSaving(
  principalId: string,
  api: DocumentsApi,
  report: (event: SaveEvent) => void,
  resources: DocumentSyncResources,
): DocumentSync {
  const reports = savingReports(report, (id) => stored.holdsUnstored(id));
  const stored = createDocumentSync({
    principalId,
    api,
    ...resources,
    ...reports,
    onSaveRefused: (id, status) => {
      // An expired session stops and hides the drafts but keeps their copies for
      // the same person. A 403 is not about identity, so nothing is withdrawn.
      if (status === 401) stored.fence();
      reports.onSaveRefused(id, status);
    },
  });
  return stored;
}

/** A member's documents, wherever the manager opens. */
export function useDocumentSaving(
  principalId: string,
  socketUrl: string | null = null,
): SaveStatus & {
  readonly sync: DocumentSync;
} {
  const [page, dispatch] = useReducer(reduceSave, initialSavePage);
  const sync = useMemo(
    () =>
      documentSaving(
        principalId,
        createDocumentsApi(),
        (event) => {
          dispatch(event);
          if (event.type === 'refused' && event.status === 401)
            window.dispatchEvent(new Event(DRAFTS_IDENTITY_CHECK_EVENT));
        },
        browserDraftResources(),
      ),
    [principalId],
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
  return { sync, ...saveStatusOf(page) };
}
