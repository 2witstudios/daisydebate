import { sameDocumentHtml } from '../../features/documents/document-lines';
import type { MemberDocument } from '../../features/documents/document';
import type { KeepaliveBudget } from './keepalive-budget';
import {
  acknowledgeDraftRecord,
  discardDraftRecord,
  editDraftRecord,
  newDraftCopy,
  draftCopies,
  sameDraftCopy,
  offerDraftRecord,
  ownUnansweredCommit,
  restoreDraftRecord,
  settleDraftRecord,
  type DraftCopy,
  type DraftRecord,
  type DraftTransition,
} from './document-draft';
import {
  createDraftStorage,
  type DraftStorage,
  type DraftSnapshot,
} from './document-draft-storage';

export type StoredDocument = MemberDocument & { readonly revision: number };
export type SaveResult = {
  readonly status: 'saved' | 'conflict';
  readonly revision: number;
};
export type DocumentsApi = {
  readonly list: (roundId: string) => Promise<readonly StoredDocument[]>;
  readonly create: (input: {
    readonly roundId: string;
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
/** A retained copy, with the last server text this owner has proven to compare it against. */
export type DraftOffer = {
  readonly documentId: string;
  readonly slot: 'active' | 'recovery';
  readonly copy: DraftCopy;
  readonly serverHtml: string;
};
export type DocumentSyncResources = {
  readonly timers: Timers;
  readonly storage: DraftStorage | null;
  readonly budget: KeepaliveBudget;
  readonly wallClock: () => number;
  readonly nextGeneration: () => string;
};
export type DocumentSync = {
  readonly load: () => Promise<readonly StoredDocument[]>;
  readonly create: () => Promise<StoredDocument>;
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
const retryable = (status: number | null) =>
  status === null || status === 408 || status === 429 || status >= 500;
const UNANSWERED_LIMIT = 8;
const LATE_COMMIT_RECHECK_MS = 2000;
const LONGEST_TIMER_MS = 2 ** 31 - 1;
const sameOffers = (one: readonly DraftOffer[], two: readonly DraftOffer[]) =>
  one.length === two.length &&
  one.every((offer, i) => {
    const other = two[i];
    return (
      other !== undefined &&
      offer.documentId === other.documentId &&
      offer.slot === other.slot &&
      offer.serverHtml === other.serverHtml &&
      sameDraftCopy(offer.copy, other.copy)
    );
  });

/** One Round's runtime owner. Every clock, ID, storage, timer and transport effect is explicit. */
export function createDocumentSync({
  api,
  roundId,
  principalId,
  timers,
  storage,
  budget,
  wallClock,
  nextGeneration,
  onConflict,
  onChanged = () => {},
  onSaved = () => {},
  onSaveFailed = () => {},
  onSaveRefused = () => {},
  onDraftStorageFailed = () => {},
  onRecoveryChanged = () => {},
  delayMs = 1000,
}: DocumentSyncResources & {
  readonly api: DocumentsApi;
  readonly roundId: string;
  readonly principalId: string;
  readonly onConflict: (id: string) => void;
  readonly onChanged?: (id: string) => void;
  readonly onSaved?: (id: string) => void;
  readonly onSaveFailed?: (id: string, attempts: number) => void;
  readonly onSaveRefused?: (id: string, status: number) => void;
  readonly onDraftStorageFailed?: (id: string) => void;
  readonly onRecoveryChanged?: (offers: readonly DraftOffer[]) => void;
  readonly delayMs?: number;
}): DocumentSync {
  let offers: readonly DraftOffer[] = [];
  let expiryHandle: unknown;
  let recheckHandle: unknown;
  let closedBy: 'released' | 'fence' | 'purge' | null = null;
  const isClosed = () => closedBy !== null;
  const serverTextListeners = new Set<(id: string, html: string) => void>();
  const revisions = new Map<string, number>();
  const serverCopies = new Map<string, string>();
  const pending = new Map<string, DraftCopy>();
  const records = new Map<string, DraftSnapshot>();
  const ownedDurable = new Map<string, string>();
  // Generations this owner wrote that its next acknowledgement replaces.
  const ownEarlier = new Map<string, Set<string>>();
  const handles = new Map<string, unknown>();
  const saving = new Map<string, Promise<void>>();
  const failures = new Map<string, number>();
  const refused = new Map<string, string>();
  const conflicted = new Set<string>();
  // Recent uncertain requests since the last acknowledgement, bounded because
  // they hold private text; past the bound a false conflict is the safe failure.
  const unanswered = new Map<string, readonly DraftCopy[]>();
  const latestRevisions = new Map<string, number>();
  const storageProblems = new Set<string>();
  const listeners = new Set<() => void>();
  const failedStorage = (id: string) => {
    storageProblems.add(id);
    onDraftStorageFailed(id);
  };
  const drafts = createDraftStorage({
    storage,
    principalId,
    failed: failedStorage,
  });
  const owned = (id: string, generation: string) =>
    pending.get(id)?.generation === generation ||
    ownedDurable.get(id) === generation;
  const activeOffered = (id: string, record: DraftRecord) =>
    record.active !== undefined && !owned(id, record.active.generation);
  /** A copy matching the server's text is finished. */
  const settledBy = (record: DraftRecord, doc: StoredDocument) =>
    settleDraftRecord(record, (html) => sameDocumentHtml(html, doc.html));
  const remember = (documents: readonly StoredDocument[]) => {
    for (const doc of documents) {
      revisions.set(doc.id, doc.revision);
      serverCopies.set(doc.id, doc.html);
    }
    return documents;
  };
  const read = (id: string, now: number): DraftSnapshot => {
    // A foreign tab's copy can legitimately be ahead of this tab's server
    // snapshot. Preserve it structurally; publish never offers a future base.
    const snapshot = drafts.read(id, now);
    records.set(id, snapshot);
    return snapshot;
  };
  const write = (
    id: string,
    previous: DraftSnapshot,
    record: DraftRecord,
    now: number,
  ) => {
    const result = drafts.write(id, previous, record, now);
    records.set(id, result.snapshot);
    if (result.stored) storageProblems.delete(id);
    return result.stored;
  };
  const idle = (id: string) => {
    if (conflicted.size > 0) {
      onConflict([...conflicted][0]!);
      return;
    }
    if (pending.size !== 0) return;
    if (storageProblems.size > 0) return;
    if (offers.length > 0) onRecoveryChanged(offers);
    else onSaved(id);
  };

  const publish = () => {
    const retained = [...records].filter(
      ([, snapshot]) => draftCopies(snapshot.record).length > 0,
    );
    const next: DraftOffer[] = retained.flatMap(([documentId, { record }]) => {
      const serverHtml = serverCopies.get(documentId) ?? '';
      const candidates: DraftOffer[] = [];
      if (record.recovery)
        candidates.push({
          documentId,
          slot: 'recovery',
          copy: record.recovery,
          serverHtml,
        });
      if (record.active && activeOffered(documentId, record))
        candidates.push({
          documentId,
          slot: 'active',
          copy: record.active,
          serverHtml,
        });
      return candidates.filter(
        (offer) => offer.copy.baseRevision <= (revisions.get(documentId) ?? -1),
      );
    });
    if (!sameOffers(offers, next)) {
      const emptied = offers.length > 0 && next.length === 0;
      offers = next;
      for (const listener of listeners) listener();
      if (offers.length > 0 || emptied) idle('');
    }
    timers.clear(expiryHandle);
    const deadlines = retained.flatMap(([, snapshot]) =>
      draftCopies(snapshot.record).map((copy) => copy.expiresAt),
    );
    if (!isClosed() && deadlines.length > 0)
      expiryHandle = timers.set(
        refreshRecovery,
        Math.min(
          LONGEST_TIMER_MS,
          Math.max(0, Math.min(...deadlines) - wallClock()),
        ),
      );
  };
  function refreshRecovery() {
    if (isClosed()) return;
    const now = wallClock();
    for (const id of revisions.keys()) read(id, now);
    publish();
  }
  const persist = (id: string, copy: DraftCopy) => {
    const now = wallClock();
    const previous = read(id, now);
    const proposal = editDraftRecord(
      previous.record,
      copy,
      activeOffered(id, previous.record),
    );
    if (proposal.status !== 'changed') {
      failedStorage(id);
      publish();
      return false;
    }
    const stored = write(id, previous, proposal.record, now);
    if (stored) ownedDurable.set(id, copy.generation);
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
  const accepted = (id: string, copy: DraftCopy) => {
    pending.set(id, copy);
    onChanged(id);
    schedule(id, delayMs);
  };
  const saved = (id: string, sent: DraftCopy, revision: number) => {
    if (isClosed()) return;
    revisions.set(id, revision);
    serverCopies.set(id, sent.html);
    failures.delete(id);
    unanswered.delete(id);
    const current = pending.get(id);
    if (current?.generation === sent.generation) pending.delete(id);
    else if (current) pending.set(id, { ...current, baseRevision: revision });
    // The server holds this text now, so its durability is no longer at risk.
    if (!pending.has(id)) storageProblems.delete(id);
    const previous = read(id, wallClock());
    const proposal = acknowledgeDraftRecord(previous.record, {
      generation: sent.generation,
      revision,
      rebaseGeneration: pending.get(id)?.generation ?? null,
      supersededByThisOwner: (generation) =>
        ownEarlier.get(id)?.has(generation) === true,
    });
    if (!pending.has(id)) ownEarlier.delete(id);
    if (proposal.record !== previous.record)
      write(id, previous, proposal.record, wallClock());
    publish();
    idle(id);
  };
  const conflict = async (id: string, sent: DraftCopy, revision: number) => {
    // A failed list establishes nothing, so it goes to the retry or refusal path.
    const doc = (await api.list(roundId)).find((one) => one.id === id);
    if (isClosed()) return;
    // The server already holds exactly this text, so nothing conflicts: an exit
    // save landed after the page's look, however late.
    if (doc && sameDocumentHtml(doc.html, sent.html)) {
      saved(id, sent, doc.revision);
      return;
    }
    const own =
      doc?.revision === revision
        ? ownUnansweredCommit(unanswered.get(id) ?? [], revision, (html) =>
            sameDocumentHtml(doc.html, html),
          )
        : undefined;
    if (own) {
      saved(id, own, revision);
      return;
    }
    if (doc) {
      serverCopies.set(id, doc.html);
      const previous = read(id, wallClock());
      const settled = settledBy(previous.record, doc);
      if (settled !== previous.record)
        write(id, previous, settled, wallClock());
    }
    latestRevisions.set(id, doc?.revision ?? revision);
    conflicted.add(id);
    publish();
    onConflict(id);
  };
  const failed = (id: string, sent: DraftCopy, error: unknown) => {
    if (isClosed()) return;
    const status = statusOf(error);
    if (status !== null && !retryable(status)) {
      refused.set(id, sent.generation);
      onSaveRefused(id, status);
      return;
    }
    const earlier = unanswered.get(id) ?? [];
    if (!earlier.some((copy) => copy.generation === sent.generation)) {
      // Keep the oldest: it is the one most likely to have committed unanswered.
      const [oldest, ...rest] = earlier;
      unanswered.set(
        id,
        oldest
          ? [oldest, ...rest.slice(-(UNANSWERED_LIMIT - 2)), sent]
          : [sent],
      );
    }
    const attempts = (failures.get(id) ?? 0) + 1;
    failures.set(id, attempts);
    onSaveFailed(id, attempts);
    schedule(id, Math.min(delayMs * 2 ** attempts, 30_000));
  };
  async function attempt(id: string, keepalive: boolean): Promise<void> {
    if (isClosed()) return;
    const sent = pending.get(id),
      expectedRevision = revisions.get(id);
    if (
      !sent ||
      expectedRevision === undefined ||
      refused.get(id) === sent.generation ||
      conflicted.has(id)
    )
      return;
    const body = { id, html: sent.html, expectedRevision };
    const reservation = keepalive ? budget.reserve(body) : null;
    if (keepalive && reservation === null) {
      // Teardown cancels this timer; a page that survives pagehide resumes it.
      schedule(id, delayMs);
      return;
    }
    let acknowledged = false;
    try {
      const result = await api.save(
        keepalive ? { ...body, keepalive: true } : body,
      );
      if (result.status === 'saved') saved(id, sent, result.revision);
      else await conflict(id, sent, result.revision);
      acknowledged = true;
    } catch (error) {
      failed(id, sent, error);
    } finally {
      reservation?.release();
    }
    if (acknowledged && pending.has(id) && !isClosed() && !conflicted.has(id))
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
    return offers.some(
      (offer) =>
        offer.documentId === id && offer.copy.generation === generation,
    )
      ? previous
      : null;
  };
  const flush = async (keepalive: boolean) => {
    if (isClosed()) return;
    for (const handle of handles.values()) timers.clear(handle);
    handles.clear();
    if (keepalive) for (const [id, copy] of pending) persist(id, copy);
    await Promise.all([...pending.keys()].map((id) => saveNow(id, keepalive)));
  };
  const close = (reason: 'released' | 'fence' | 'purge') => {
    if (isClosed()) {
      // A purge after a fence still erases, and the notice must say so.
      if (reason !== 'purge' || closedBy === 'purge') return;
      closedBy = 'purge';
      drafts.purge();
      for (const listener of listeners) listener();
      return;
    }
    closedBy = reason;
    for (const handle of handles.values()) timers.clear(handle);
    timers.clear(expiryHandle);
    timers.clear(recheckHandle);
    handles.clear();
    pending.clear();
    records.clear();
    unanswered.clear();
    ownedDurable.clear();
    ownEarlier.clear();
    offers = [];
    if (reason === 'purge') drafts.purge();
    for (const listener of listeners) listener();
  };
  const reconcileLateCommits = async (offeredAtLoad: ReadonlySet<string>) => {
    if (isClosed()) return;
    const documents = await api.list(roundId).catch(() => null);
    if (isClosed() || documents === null) return;
    const now = wallClock();
    for (const doc of documents) {
      if (pending.has(doc.id) || conflicted.has(doc.id)) continue;
      const previous = read(doc.id, now);
      const settled = settledBy(previous.record, doc);
      if (settled !== previous.record) write(doc.id, previous, settled, now);
      // The offered text committed late, or an acknowledgement already cleared
      // it, and nothing here is pending, so the editor adopts the server's text.
      // The revision and the visible text only move together: moving the revision
      // alone would let the next edit overwrite the commit.
      const committed =
        settled !== previous.record ||
        (offeredAtLoad.has(doc.id) && draftCopies(settled).length === 0);
      if (committed && doc.revision > (revisions.get(doc.id) ?? -1)) {
        remember([doc]);
        for (const listener of serverTextListeners) listener(doc.id, doc.html);
      }
    }
    publish();
  };
  return {
    load: async () => {
      if (isClosed()) return [];
      const documents = await api.list(roundId);
      if (isClosed()) return [];
      remember(documents);
      const now = wallClock();
      for (const doc of documents) {
        const previous = read(doc.id, now);
        const offered = pending.has(doc.id)
          ? previous.record
          : offerDraftRecord(settledBy(previous.record, doc));
        if (offered !== previous.record) write(doc.id, previous, offered, now);
      }
      publish();
      // A previous page's exit save can commit after this list; check once.
      timers.clear(recheckHandle);
      if (offers.length > 0) {
        const offeredAtLoad = new Set(offers.map((one) => one.documentId));
        recheckHandle = timers.set(
          () => void reconcileLateCommits(offeredAtLoad),
          LATE_COMMIT_RECHECK_MS,
        );
      }
      return documents;
    },
    create: async () => {
      if (isClosed())
        throw new Error('The document owner is no longer active.');
      const doc = await api.create({ roundId });
      if (isClosed())
        throw new Error('The document owner is no longer active.');
      remember([doc]);
      return doc;
    },
    change: (id, html) => {
      const baseRevision = revisions.get(id);
      if (isClosed() || baseRevision === undefined) return;
      // Clicking into a document can make the editor normalize it. Text the
      // server already holds is no edit, unless it undoes one still pending.
      if (
        !pending.has(id) &&
        sameDocumentHtml(html, serverCopies.get(id) ?? '')
      )
        return;
      const copy = newDraftCopy({
        html,
        baseRevision,
        generation: nextGeneration(),
        now: wallClock(),
      });
      const own = ownEarlier.get(id) ?? new Set<string>();
      own.add(copy.generation);
      ownEarlier.set(id, own);
      pending.set(id, copy);
      persist(id, copy);
      if (conflicted.has(id)) {
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
      const revision = latestRevisions.get(id) ?? revisions.get(id);
      if (!previous || revision === undefined) return null;
      const proposal = restoreDraftRecord(previous.record, {
        generation,
        active: pending.get(id) ?? null,
        activeOffered: activeOffered(id, previous.record),
        newGeneration: nextGeneration(),
        revision,
      });
      if (!transition(id, previous, proposal) || !proposal.record.active)
        return null;
      const copy = proposal.record.active;
      // Text Restore set aside is a choice to keep, not a superseded draft.
      const own = ownEarlier.get(id) ?? new Set<string>();
      const setAside = proposal.record.recovery?.generation;
      if (setAside) own.delete(setAside);
      own.add(copy.generation);
      ownEarlier.set(id, own);
      ownedDurable.set(id, copy.generation);
      revisions.set(id, revision);
      latestRevisions.delete(id);
      conflicted.delete(id);
      accepted(id, copy);
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
    recoveryOffers: () => offers,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refreshRecovery,
    available: () => !isClosed(),
    fence: () => {
      const unstored = [...pending].some(
        ([id, copy]) => ownedDurable.get(id) !== copy.generation,
      );
      if (unstored) return false;
      close('fence');
      return true;
    },
    closedBy: () => closedBy,
    subscribeServerText: (listener) => {
      serverTextListeners.add(listener);
      return () => serverTextListeners.delete(listener);
    },
    dispose: ({ purge = false } = {}) => close(purge ? 'purge' : 'released'),
  };
}
