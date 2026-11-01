import { sameDocumentHtml } from '../../features/documents/document-lines';
import type {
  FolderId,
  TemplateId,
  WorkspaceDocument,
} from '../../features/debate-room/documents/documents';
import type { KeepaliveBudget } from './keepalive-budget';
import {
  acknowledgeNoteRecord,
  discardNoteRecord,
  editNoteRecord,
  newNoteCopy,
  NOTE_RECORD_MAX_COUNT,
  offerNoteRecord,
  restoreNoteRecord,
  type NoteCopy,
  type NoteOffer,
  type NoteRecord,
  type NoteTransition,
} from './note-draft';
import {
  createNoteStorage,
  type DraftStorage,
  type NoteSnapshot,
} from './note-draft-storage';

export type StoredDocument = WorkspaceDocument & { readonly revision: number };
export type SaveResult = {
  readonly status: 'saved' | 'conflict';
  readonly revision: number;
};
export type DocumentsApi = {
  readonly list: (roundId: string) => Promise<readonly StoredDocument[]>;
  readonly create: (input: {
    readonly roundId: string;
    readonly folder: Exclude<FolderId, 'club'>;
    readonly templateId: TemplateId;
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
export type DocumentSyncResources = {
  readonly timers: Timers;
  readonly storage: DraftStorage | null;
  readonly budget: KeepaliveBudget;
  readonly wallClock: () => number;
  readonly nextGeneration: () => string;
};
export type DocumentSync = {
  readonly load: () => Promise<readonly StoredDocument[]>;
  readonly create: (
    folder: Exclude<FolderId, 'club'>,
    templateId: TemplateId,
  ) => Promise<StoredDocument>;
  readonly change: (id: string, html: string) => void;
  readonly flush: () => Promise<void>;
  readonly flushKeepalive: () => Promise<void>;
  readonly recoveryOffers: () => readonly NoteOffer[];
  readonly subscribe: (listener: () => void) => () => void;
  readonly refreshRecovery: () => void;
  readonly restoreRecovered: (id: string, generation: string) => string | null;
  readonly discardRecovered: (id: string, generation: string) => boolean;
  readonly available: () => boolean;
  readonly dispose: (options?: { readonly purge?: boolean }) => void;
};
const statusOf = (error: unknown): number | null => {
  const status = (error as { readonly status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
};
const retryable = (status: number | null) =>
  status === null || status === 408 || status === 429 || status >= 500;
const copiesOf = (record: NoteRecord): readonly NoteCopy[] =>
  [record.active, record.recovery].filter(
    (copy): copy is NoteCopy => copy !== undefined,
  );
const sameOffers = (one: readonly NoteOffer[], two: readonly NoteOffer[]) =>
  one.length === two.length &&
  one.every((offer, i) => {
    const other = two[i];
    return (
      other !== undefined &&
      offer.documentId === other.documentId &&
      offer.slot === other.slot &&
      offer.copy.generation === other.copy.generation &&
      offer.copy.html === other.copy.html &&
      offer.copy.baseRevision === other.copy.baseRevision &&
      offer.copy.savedAt === other.copy.savedAt &&
      offer.copy.expiresAt === other.copy.expiresAt
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
  readonly onRecoveryChanged?: (offers: readonly NoteOffer[]) => void;
  readonly delayMs?: number;
}): DocumentSync {
  let disposed = false;
  let offers: readonly NoteOffer[] = [];
  let unavailableCopies = false;
  let expiryHandle: unknown;
  const revisions = new Map<string, number>();
  const pending = new Map<string, NoteCopy>();
  const records = new Map<string, NoteSnapshot>();
  const ownedDurable = new Map<string, string>();
  const handles = new Map<string, unknown>();
  const saving = new Map<string, Promise<void>>();
  const failures = new Map<string, number>();
  const refused = new Map<string, string>();
  const conflicted = new Set<string>();
  // One uncertain request, not an unbounded history of private note content.
  const unanswered = new Map<string, NoteCopy>();
  const storageProblems = new Set<string>();
  const listeners = new Set<() => void>();
  const failedStorage = (id: string) => {
    storageProblems.add(id);
    onDraftStorageFailed(id);
  };
  const drafts = createNoteStorage({
    storage,
    principalId,
    roundId,
    failed: failedStorage,
  });
  const owned = (id: string, generation: string) =>
    pending.get(id)?.generation === generation ||
    ownedDurable.get(id) === generation;
  const activeOffered = (id: string, record: NoteRecord) =>
    record.active !== undefined && !owned(id, record.active.generation);
  const remember = (documents: readonly StoredDocument[]) => {
    for (const doc of documents) revisions.set(doc.id, doc.revision);
    return documents;
  };
  const read = (id: string, now: number): NoteSnapshot => {
    // A foreign tab's copy can legitimately be ahead of this tab's server
    // snapshot. Preserve it structurally; publish never offers a future base.
    const snapshot = drafts.read(id, now);
    records.set(id, snapshot);
    return snapshot;
  };
  const write = (
    id: string,
    previous: NoteSnapshot,
    record: NoteRecord,
    now: number,
  ) => {
    const result = drafts.write(id, previous, record, now);
    records.set(id, result.snapshot);
    if (result.stored) storageProblems.delete(id);
    return result.stored;
  };
  const idle = (id: string) => {
    if (pending.size !== 0) return;
    if (storageProblems.size > 0 || unavailableCopies) return;
    if (offers.length > 0) onRecoveryChanged(offers);
    else onSaved(id);
  };

  const publish = () => {
    const retained = [...records].filter(
      ([, snapshot]) => copiesOf(snapshot.record).length > 0,
    );
    unavailableCopies =
      retained.length > NOTE_RECORD_MAX_COUNT ||
      retained.some(([id, snapshot]) =>
        copiesOf(snapshot.record).some(
          (copy) => copy.baseRevision > (revisions.get(id) ?? -1),
        ),
      );
    if (unavailableCopies) onDraftStorageFailed('');
    const next: NoteOffer[] = retained
      .slice(0, NOTE_RECORD_MAX_COUNT)
      .flatMap(([documentId, { record }]) => {
        const candidates: NoteOffer[] = [];
        if (record.recovery)
          candidates.push({
            documentId,
            slot: 'recovery',
            copy: record.recovery,
          });
        if (record.active && activeOffered(documentId, record))
          candidates.push({ documentId, slot: 'active', copy: record.active });
        return candidates.filter(
          (offer) =>
            offer.copy.baseRevision <= (revisions.get(documentId) ?? -1),
        );
      });
    if (!sameOffers(offers, next)) {
      offers = next;
      for (const listener of listeners) listener();
      if (offers.length > 0 && storageProblems.size === 0 && !unavailableCopies)
        onRecoveryChanged(offers);
    }
    timers.clear(expiryHandle);
    const deadlines = retained.flatMap(([, snapshot]) =>
      copiesOf(snapshot.record).map((copy) => copy.expiresAt),
    );
    if (!disposed && deadlines.length > 0)
      expiryHandle = timers.set(
        refreshRecovery,
        Math.max(0, Math.min(...deadlines) - wallClock()),
      );
  };
  function refreshRecovery() {
    if (disposed) return;
    const now = wallClock();
    for (const id of revisions.keys()) read(id, now);
    publish();
  }
  const persist = (id: string, copy: NoteCopy) => {
    const now = wallClock();
    const previous = read(id, now);
    const proposal = editNoteRecord(
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
  const accepted = (id: string, copy: NoteCopy) => {
    pending.set(id, copy);
    onChanged(id);
    schedule(id, delayMs);
  };
  const saved = (id: string, sent: NoteCopy, revision: number) => {
    if (disposed) return;
    revisions.set(id, revision);
    failures.delete(id);
    unanswered.delete(id);
    const current = pending.get(id);
    if (current?.generation === sent.generation) pending.delete(id);
    else if (current) pending.set(id, { ...current, baseRevision: revision });
    const previous = read(id, wallClock());
    const proposal = acknowledgeNoteRecord(previous.record, {
      generation: sent.generation,
      revision,
      rebaseGeneration: pending.get(id)?.generation ?? null,
    });
    write(id, previous, proposal.record, wallClock());
    // A memory-only newer edit must also attempt durable rebasing; failure
    // preserves the old offer and leaves the current text in the online path.
    const later = pending.get(id);
    if (later) persist(id, later);
    publish();
    idle(id);
  };
  const conflict = async (id: string, revision: number) => {
    const uncertain = unanswered.get(id);
    if (uncertain && revision === uncertain.baseRevision + 1) {
      const doc = (await api.list(roundId)).find((one) => one.id === id);
      if (disposed) return;
      if (
        doc?.revision === revision &&
        sameDocumentHtml(doc.html, uncertain.html)
      ) {
        saved(id, uncertain, revision);
        return;
      }
    }
    if (disposed) return;
    conflicted.add(id);
    onConflict(id);
  };
  const failed = (id: string, sent: NoteCopy, error: unknown) => {
    if (disposed) return;
    const status = statusOf(error);
    if (status !== null && !retryable(status)) {
      refused.set(id, sent.generation);
      onSaveRefused(id, status);
      return;
    }
    if (!unanswered.has(id)) unanswered.set(id, sent);
    const attempts = (failures.get(id) ?? 0) + 1;
    failures.set(id, attempts);
    onSaveFailed(id, attempts);
    schedule(id, Math.min(delayMs * 2 ** attempts, 30_000));
  };
  async function attempt(id: string, keepalive: boolean): Promise<void> {
    if (disposed) return;
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
      persist(id, sent);
      return;
    }
    let acknowledged = false;
    try {
      const result = await api.save(
        keepalive ? { ...body, keepalive: true } : body,
      );
      if (result.status === 'saved') saved(id, sent, result.revision);
      else await conflict(id, result.revision);
      acknowledged = true;
    } catch (error) {
      failed(id, sent, error);
    } finally {
      reservation?.release();
    }
    if (acknowledged && pending.has(id) && !disposed && !conflicted.has(id))
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
    previous: NoteSnapshot,
    result: NoteTransition,
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
    if (disposed) return;
    for (const handle of handles.values()) timers.clear(handle);
    handles.clear();
    if (keepalive) for (const [id, copy] of pending) persist(id, copy);
    await Promise.all([...pending.keys()].map((id) => saveNow(id, keepalive)));
  };
  return {
    load: async () => {
      if (disposed) return [];
      const documents = await api.list(roundId);
      if (disposed) return [];
      remember(documents);
      const now = wallClock();
      for (const doc of documents) {
        const previous = read(doc.id, now);
        const offered = pending.has(doc.id)
          ? previous.record
          : offerNoteRecord(previous.record);
        if (offered !== previous.record) write(doc.id, previous, offered, now);
      }
      publish();
      return documents;
    },
    create: async (folder, templateId) => {
      if (disposed) throw new Error('The document owner is no longer active.');
      const doc = await api.create({ roundId, folder, templateId });
      if (disposed) throw new Error('The document owner is no longer active.');
      remember([doc]);
      return doc;
    },
    change: (id, html) => {
      const baseRevision = revisions.get(id);
      if (disposed || baseRevision === undefined) return;
      const copy = newNoteCopy({
        html,
        baseRevision,
        generation: nextGeneration(),
        now: wallClock(),
      });
      accepted(id, copy);
      persist(id, copy);
    },
    restoreRecovered: (id, generation) => {
      if (disposed) return null;
      const previous = currentOffer(id, generation),
        revision = revisions.get(id);
      if (!previous || revision === undefined) return null;
      const proposal = restoreNoteRecord(previous.record, {
        generation,
        active: pending.get(id) ?? null,
        activeOffered: activeOffered(id, previous.record),
        newGeneration: nextGeneration(),
        revision,
      });
      if (!transition(id, previous, proposal) || !proposal.record.active)
        return null;
      const copy = proposal.record.active;
      ownedDurable.set(id, copy.generation);
      accepted(id, copy);
      publish();
      return copy.html;
    },
    discardRecovered: (id, generation) => {
      if (disposed) return false;
      const previous = currentOffer(id, generation);
      if (
        !previous ||
        !transition(
          id,
          previous,
          discardNoteRecord(previous.record, generation),
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
    available: () => !disposed,
    dispose: ({ purge = false } = {}) => {
      if (disposed) return;
      disposed = true;
      for (const handle of handles.values()) timers.clear(handle);
      timers.clear(expiryHandle);
      handles.clear();
      pending.clear();
      records.clear();
      unanswered.clear();
      ownedDurable.clear();
      offers = [];
      if (purge) drafts.purge();
      for (const listener of listeners) listener();
    },
  };
}
