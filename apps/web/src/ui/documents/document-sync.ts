import type { MemberDocument } from '../../features/documents/document';
import type { KeepaliveBudget } from './keepalive-budget';
import {
  discardDraftRecord,
  editDraftRecord,
  newDraftCopy,
  draftCopies,
  offerDraftRecord,
  restoreDraftRecord,
  type DraftCopy,
  type DraftRecord,
  type DraftTransition,
} from '../../features/documents/document-draft';
import {
  acknowledged,
  activeOffered,
  attemptFailed,
  closed,
  conflictOutcome,
  edited,
  holdsUnstoredText,
  idleSignal,
  initialSaving,
  isNoEdit,
  nextExpiry,
  nextSend,
  offersOf,
  restored,
  sameOffers,
  savingDocument,
  serverRead,
  settledBy,
  withDocument,
  type DraftOffer,
  type DraftSnapshot,
  type SavingDocument,
  type SavingState,
} from '../../features/documents/document-saving';
import {
  createDraftStorage,
  type DraftStorage,
} from './document-draft-storage';

export type StoredDocument = MemberDocument & { readonly revision: number };
export type SaveResult = {
  readonly status: 'saved' | 'conflict';
  readonly revision: number;
};
export type DocumentsApi = {
  /** Only bodies asked for, and only the caller's; an absent id is simply left out. */
  readonly read: (ids: readonly string[]) => Promise<readonly StoredDocument[]>;
  /** The document edited last, to land on when nothing is open. */
  readonly recent: () => Promise<string | null>;
  readonly create: (input: {
    readonly folderId: string | null;
  }) => Promise<StoredDocument>;
  readonly save: (input: {
    readonly id: string;
    readonly html: string;
    readonly expectedRevision: number;
    readonly keepalive?: boolean;
  }) => Promise<SaveResult>;
};
export type Timers = {
  readonly set: (run: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
};
export type { DraftOffer };
export type DocumentSyncResources = {
  readonly timers: Timers;
  readonly storage: DraftStorage | null;
  readonly budget: KeepaliveBudget;
  readonly wallClock: () => number;
  readonly nextGeneration: () => string;
};
export type DocumentSync = {
  readonly load: () => Promise<readonly StoredDocument[]>;
  readonly create: (folderId?: string | null) => Promise<StoredDocument>;
  /** Reads a document into this owner, with any draft it has here; null when gone. */
  readonly open: (id: string) => Promise<StoredDocument | null>;
  /** Marks open documents the server no longer has. */
  readonly recheck: (ids: readonly string[]) => Promise<void>;
  /** The kept text of a deleted document, as a new document. */
  readonly saveAsNew: (id: string) => Promise<StoredDocument | null>;
  /** A document open here that the server no longer has, or null. */
  readonly firstGone: () => string | null;
  /** This person deleted it here, so nothing of it stays. */
  readonly forget: (id: string) => void;
  readonly change: (id: string, html: string) => void;
  readonly flush: () => Promise<void>;
  readonly flushKeepalive: () => Promise<void>;
  readonly recoveryOffers: () => readonly DraftOffer[];
  readonly subscribe: (listener: () => void) => () => void;
  readonly refreshRecovery: () => void;
  readonly restoreRecovered: (id: string, generation: string) => string | null;
  readonly discardRecovered: (id: string, generation: string) => boolean;
  readonly available: () => boolean;
  readonly dispose: (options?: { readonly purge?: boolean }) => void;
  /** Stop and hide for an ended session, unless that would destroy unstored text. */
  readonly fence: () => boolean;
  readonly closedBy: () => 'released' | 'fence' | 'purge' | null;
  /** Server text the editor should now show: this owner's own late commit. */
  readonly subscribeServerText: (
    listener: (id: string, html: string) => void,
  ) => () => void;
};
const statusOf = (error: unknown): number | null => {
  const status = (error as { readonly status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
};
const LATE_COMMIT_RECHECK_MS = 2000;
const LONGEST_TIMER_MS = 2 ** 31 - 1;

/**
 * One owner's edge: it holds the one saving state, and runs what the pure
 * decisions in `document-saving` ask for. Every clock, ID, storage, timer and
 * transport effect is explicit.
 */
export function createDocumentSync({
  api,
  principalId,
  timers,
  storage,
  budget,
  wallClock,
  nextGeneration,
  onConflict,
  onGone = () => {},
  onChanged = () => {},
  onSaved = () => {},
  onSaveFailed = () => {},
  onSaveRefused = () => {},
  onDraftStorageFailed = () => {},
  onRecoveryChanged = () => {},
  delayMs = 1000,
}: DocumentSyncResources & {
  readonly api: DocumentsApi;
  readonly principalId: string;
  readonly onGone?: (id: string) => void;
  readonly onConflict: (id: string) => void;
  readonly onChanged?: (id: string) => void;
  readonly onSaved?: (id: string) => void;
  readonly onSaveFailed?: (id: string, attempts: number) => void;
  readonly onSaveRefused?: (id: string, status: number) => void;
  readonly onDraftStorageFailed?: (id: string) => void;
  readonly onRecoveryChanged?: (offers: readonly DraftOffer[]) => void;
  readonly delayMs?: number;
}): DocumentSync {
  let state: SavingState = initialSaving;
  let expiryHandle: unknown;
  let recheckHandle: unknown;
  const isClosed = () => state.closedBy !== null;
  const doc = (id: string) => savingDocument(state, id);
  const update = (
    id: string,
    change: (d: SavingDocument) => SavingDocument,
  ) => {
    state = withDocument(state, id, change);
  };
  const serverTextListeners = new Set<(id: string, html: string) => void>();
  const handles = new Map<string, unknown>();
  const saving = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  const failedStorage = (id: string) => {
    update(id, (d) => ({ ...d, storageProblem: true }));
    onDraftStorageFailed(id);
  };
  const drafts = createDraftStorage({
    storage,
    principalId,
    failed: failedStorage,
  });
  const remember = (documents: readonly StoredDocument[]) => {
    for (const one of documents) update(one.id, (d) => serverRead(d, one));
    return documents;
  };
  const read = (id: string, now: number): DraftSnapshot => {
    // A foreign tab's copy can legitimately be ahead of this tab's server
    // snapshot. Preserve it structurally; publish never offers a future base.
    const snapshot = drafts.read(id, now);
    update(id, (d) => ({ ...d, snapshot }));
    return snapshot;
  };
  const write = (
    id: string,
    previous: DraftSnapshot,
    record: DraftRecord,
    now: number,
  ) => {
    const result = drafts.write(id, previous, record, now);
    update(id, (d) => ({
      ...d,
      snapshot: result.snapshot,
      storageProblem: result.stored ? false : d.storageProblem,
    }));
    return result.stored;
  };
  const idle = (id: string) => {
    const signal = idleSignal(state);
    if (signal.kind === 'conflict') onConflict(signal.id);
    else if (signal.kind === 'recovery') onRecoveryChanged(state.offers);
    else if (signal.kind === 'saved') onSaved(id);
  };

  const publish = () => {
    const next = offersOf(state.documents);
    if (!sameOffers(state.offers, next)) {
      const emptied = state.offers.length > 0 && next.length === 0;
      state = { ...state, offers: next };
      for (const listener of listeners) listener();
      if (next.length > 0 || emptied) idle('');
    }
    timers.clear(expiryHandle);
    const expiry = nextExpiry(state.documents);
    if (!isClosed() && expiry !== null)
      expiryHandle = timers.set(
        refreshRecovery,
        Math.min(LONGEST_TIMER_MS, Math.max(0, expiry - wallClock())),
      );
  };
  function refreshRecovery() {
    if (isClosed()) return;
    const now = wallClock();
    for (const [id, d] of state.documents)
      if (d.revision !== undefined) read(id, now);
    publish();
  }
  const persist = (id: string, copy: DraftCopy) => {
    const now = wallClock();
    const previous = read(id, now);
    const proposal = editDraftRecord(
      previous.record,
      copy,
      activeOffered(doc(id), previous.record),
    );
    if (proposal.status !== 'changed') {
      failedStorage(id);
      publish();
      return false;
    }
    const stored = write(id, previous, proposal.record, now);
    if (stored)
      update(id, (d) => ({ ...d, durableGeneration: copy.generation }));
    publish();
    return stored;
  };
  const schedule = (id: string, ms: number) => {
    timers.clear(handles.get(id));
    handles.set(
      id,
      timers.set(() => void saveNow(id), ms),
    );
  };
  const saved = (id: string, sent: DraftCopy, revision: number) => {
    if (isClosed()) return;
    const previous = read(id, wallClock());
    const result = acknowledged(doc(id), sent, revision, previous.record);
    update(id, () => result.document);
    if (result.draft.record !== previous.record)
      write(id, previous, result.draft.record, wallClock());
    publish();
    idle(id);
  };
  const markGone = (id: string) => {
    update(id, (d) => ({ ...d, gone: true }));
    publish();
    for (const listener of listeners) listener();
    onGone(id);
  };
  const conflict = async (id: string, sent: DraftCopy, revision: number) => {
    // A failed read establishes nothing, so it goes to the retry or refusal path.
    const [server] = await api.read([id]);
    if (isClosed()) return;
    const outcome = conflictOutcome(doc(id), sent, revision, server);
    if (outcome.kind === 'gone') {
      markGone(id);
      return;
    }
    if (outcome.kind === 'committed') {
      saved(id, outcome.copy, outcome.revision);
      return;
    }
    update(id, (d) => ({ ...d, serverHtml: server!.html }));
    const previous = read(id, wallClock());
    const settled = settledBy(previous.record, server!.html);
    if (settled !== previous.record) write(id, previous, settled, wallClock());
    update(id, (d) => ({
      ...d,
      conflict: { latestRevision: outcome.latestRevision },
    }));
    publish();
    onConflict(id);
  };
  const failed = (id: string, sent: DraftCopy, error: unknown) => {
    if (isClosed()) return;
    const result = attemptFailed(doc(id), sent, statusOf(error), delayMs);
    update(id, () => result.document);
    if (result.kind === 'gone') {
      markGone(id);
      return;
    }
    if (result.kind === 'refused') {
      onSaveRefused(id, result.status);
      return;
    }
    onSaveFailed(id, result.attempts);
    schedule(id, result.afterMs);
  };
  async function attempt(id: string, keepalive: boolean): Promise<void> {
    if (isClosed()) return;
    const ready = nextSend(doc(id));
    if (!ready) return;
    const { sent, expectedRevision } = ready;
    const body = { id, html: sent.html, expectedRevision };
    const reservation = keepalive ? budget.reserve(body) : null;
    if (keepalive && reservation === null) {
      // Teardown cancels this timer; a page that survives pagehide resumes it.
      schedule(id, delayMs);
      return;
    }
    let answered = false;
    try {
      const result = await api.save(
        keepalive ? { ...body, keepalive: true } : body,
      );
      if (result.status === 'saved') saved(id, sent, result.revision);
      else await conflict(id, sent, result.revision);
      answered = true;
    } catch (error) {
      failed(id, sent, error);
    } finally {
      reservation?.release();
    }
    if (answered && !isClosed() && doc(id).pending && !doc(id).conflict)
      await attempt(id, false);
  }
  function saveNow(id: string, keepalive = false): Promise<void> {
    const current = saving.get(id);
    // Repeated pagehide notifications share the outstanding send. Ordinary
    // callers can queue a later edit even when the first request fails.
    if (current && keepalive) return current;
    const work = current
      ? current.then(() => attempt(id, false))
      : attempt(id, keepalive);
    const run = work.finally(() => {
      if (saving.get(id) === run) saving.delete(id);
    });
    saving.set(id, run);
    return run;
  }

  const transition = (
    id: string,
    previous: DraftSnapshot,
    result: DraftTransition,
  ) => {
    if (result.status !== 'changed') {
      if (result.status !== 'stale') failedStorage(id);
      publish();
      return false;
    }
    const stored = write(id, previous, result.record, wallClock());
    publish();
    return stored;
  };
  const currentOffer = (id: string, generation: string) => {
    const previous = read(id, wallClock());
    publish();
    return state.offers.some(
      (offer) =>
        offer.documentId === id && offer.copy.generation === generation,
    )
      ? previous
      : null;
  };
  const pendingIds = () =>
    [...state.documents].filter(([, d]) => d.pending).map(([id]) => id);
  const flush = async (keepalive: boolean) => {
    if (isClosed()) return;
    for (const handle of handles.values()) timers.clear(handle);
    handles.clear();
    if (keepalive) for (const id of pendingIds()) persist(id, doc(id).pending!);
    await Promise.all(pendingIds().map((id) => saveNow(id, keepalive)));
  };
  const close = (reason: 'released' | 'fence' | 'purge') => {
    if (isClosed()) {
      // A purge after a fence still erases, and the notice must say so.
      if (reason !== 'purge' || state.closedBy === 'purge') return;
      state = { ...state, closedBy: 'purge' };
      drafts.purge();
      for (const listener of listeners) listener();
      return;
    }
    state = closed(state, reason);
    for (const handle of handles.values()) timers.clear(handle);
    timers.clear(expiryHandle);
    timers.clear(recheckHandle);
    handles.clear();
    if (reason === 'purge') drafts.purge();
    for (const listener of listeners) listener();
  };
  const reconcileLateCommits = async (offeredAtLoad: ReadonlySet<string>) => {
    if (isClosed()) return;
    const documents = await api.read([...offeredAtLoad]).catch(() => null);
    if (isClosed() || documents === null) return;
    const now = wallClock();
    for (const one of documents) {
      if (doc(one.id).pending || doc(one.id).conflict) continue;
      const previous = read(one.id, now);
      const settled = settledBy(previous.record, one.html);
      if (settled !== previous.record) write(one.id, previous, settled, now);
      // The offered text committed late, or an acknowledgement already cleared
      // it, and nothing here is pending, so the editor adopts the server's text.
      // The revision and the visible text only move together: moving the revision
      // alone would let the next edit overwrite the commit.
      const committed =
        settled !== previous.record ||
        (offeredAtLoad.has(one.id) && draftCopies(settled).length === 0);
      if (committed && one.revision > (doc(one.id).revision ?? -1)) {
        remember([one]);
        for (const listener of serverTextListeners) listener(one.id, one.html);
      }
    }
    publish();
  };
  const adopt = (documents: readonly StoredDocument[]) => {
    remember(documents);
    const now = wallClock();
    for (const one of documents) {
      const previous = read(one.id, now);
      const offered = doc(one.id).pending
        ? previous.record
        : offerDraftRecord(settledBy(previous.record, one.html));
      if (offered !== previous.record) write(one.id, previous, offered, now);
    }
  };
  const forgetDocument = (id: string) => {
    timers.clear(handles.get(id));
    handles.delete(id);
    const now = wallClock();
    const previous = read(id, now);
    if (draftCopies(previous.record).length > 0) write(id, previous, {}, now);
    state = {
      ...state,
      documents: new Map(
        [...state.documents].filter(([other]) => other !== id),
      ),
    };
    publish();
  };
  return {
    load: async () => {
      if (isClosed()) return [];
      const recent = await api.recent();
      const ids = [
        ...new Set([...drafts.documentIds(), ...(recent ? [recent] : [])]),
      ];
      const documents = ids.length > 0 ? await api.read(ids) : [];
      if (isClosed()) return [];
      adopt(documents);
      publish();
      // A previous page's exit save can commit after this read; check once.
      timers.clear(recheckHandle);
      if (state.offers.length > 0) {
        const offeredAtLoad = new Set(
          state.offers.map((one) => one.documentId),
        );
        recheckHandle = timers.set(
          () => void reconcileLateCommits(offeredAtLoad),
          LATE_COMMIT_RECHECK_MS,
        );
      }
      return documents;
    },
    open: async (id) => {
      if (isClosed()) return null;
      const [opened] = await api.read([id]);
      if (isClosed() || !opened) return null;
      adopt([opened]);
      publish();
      return opened;
    },
    recheck: async (ids) => {
      if (isClosed() || ids.length === 0) return;
      const documents = await api.read(ids).catch(() => null);
      if (isClosed() || documents === null) return;
      const present = new Set(documents.map((one) => one.id));
      for (const id of ids) if (!present.has(id) && !doc(id).gone) markGone(id);
    },
    saveAsNew: async (id) => {
      if (isClosed() || !doc(id).gone) return null;
      const text = doc(id).pending?.html;
      const created = await api.create({ folderId: null });
      if (isClosed()) return null;
      remember([created]);
      if (text !== undefined) {
        const copy = newDraftCopy({
          html: text,
          baseRevision: created.revision,
          generation: nextGeneration(),
          now: wallClock(),
        });
        update(created.id, (d) => edited(d, copy));
        persist(created.id, copy);
        onChanged(created.id);
        schedule(created.id, 0);
      }
      forgetDocument(id);
      return { ...created, html: text ?? created.html };
    },
    forget: (id) => forgetDocument(id),
    firstGone: () => [...state.documents].find(([, d]) => d.gone)?.[0] ?? null,
    create: async (folderId = null) => {
      if (isClosed())
        throw new Error('The document owner is no longer active.');
      const created = await api.create({ folderId });
      if (isClosed())
        throw new Error('The document owner is no longer active.');
      remember([created]);
      return created;
    },
    change: (id, html) => {
      const baseRevision = doc(id).revision;
      if (isClosed() || baseRevision === undefined) return;
      // Clicking into a document can make the editor normalize it.
      if (isNoEdit(doc(id), html)) return;
      const copy = newDraftCopy({
        html,
        baseRevision,
        generation: nextGeneration(),
        now: wallClock(),
      });
      update(id, (d) => edited(d, copy));
      persist(id, copy);
      if (doc(id).conflict) {
        // Nothing sends until the conflict resolves, so never claim "saving".
        onConflict(id);
        return;
      }
      onChanged(id);
      schedule(id, delayMs);
    },
    restoreRecovered: (id, generation) => {
      if (isClosed()) return null;
      const previous = currentOffer(id, generation);
      // Restore is the explicit choice that resolves a conflict: it saves
      // against the fresh server revision, through the ordinary CAS.
      const revision = doc(id).conflict?.latestRevision ?? doc(id).revision;
      if (!previous || revision === undefined) return null;
      const proposal = restoreDraftRecord(previous.record, {
        generation,
        active: doc(id).pending ?? null,
        activeOffered: activeOffered(doc(id), previous.record),
        newGeneration: nextGeneration(),
        revision,
      });
      if (!transition(id, previous, proposal) || !proposal.record.active)
        return null;
      const copy = proposal.record.active;
      update(id, (d) =>
        restored(d, copy, proposal.record.recovery?.generation, revision),
      );
      onChanged(id);
      schedule(id, delayMs);
      publish();
      return copy.html;
    },
    discardRecovered: (id, generation) => {
      if (isClosed()) return false;
      const previous = currentOffer(id, generation);
      if (
        !previous ||
        !transition(
          id,
          previous,
          discardDraftRecord(previous.record, generation),
        )
      )
        return false;
      idle(id);
      return true;
    },
    flush: () => flush(false),
    flushKeepalive: () => flush(true),
    recoveryOffers: () => state.offers,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refreshRecovery,
    available: () => !isClosed(),
    fence: () => {
      if (holdsUnstoredText(state)) return false;
      close('fence');
      return true;
    },
    closedBy: () => state.closedBy,
    subscribeServerText: (listener) => {
      serverTextListeners.add(listener);
      return () => serverTextListeners.delete(listener);
    },
    dispose: ({ purge = false } = {}) => close(purge ? 'purge' : 'released'),
  };
}
