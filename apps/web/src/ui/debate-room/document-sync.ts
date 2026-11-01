import {
  breakLines,
  sameDocumentHtml,
} from '../../features/documents/document-lines';
import type { KeepaliveBudget } from './keepalive-budget';
import type {
  FolderId,
  TemplateId,
  WorkspaceDocument,
} from '../../features/debate-room/documents/documents';

export type StoredDocument = WorkspaceDocument & { readonly revision: number };

export type SaveResult =
  | { readonly status: 'saved'; readonly revision: number }
  | { readonly status: 'conflict'; readonly revision: number };

/** The server's document routes, as the room calls them. */
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

/** Storage seam supplied by the authenticated browser owner. */
export type DraftStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'
>;

export type RecoveredDraft = {
  readonly html: string;
  readonly baseRevision: number;
  readonly generation: number;
  readonly savedAt: number;
  readonly expiresAt: number;
};

const nonnegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Scalar browser record validation has no schema compilation or ambient effects. */
const parseDraft = (value: unknown): RecoveredDraft | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null;
  const fields = [
    'html',
    'baseRevision',
    'generation',
    'savedAt',
    'expiresAt',
  ] as const;
  if (!fields.every((field) => Object.hasOwn(value, field))) return null;
  const { html, baseRevision, generation, savedAt, expiresAt } =
    value as Record<string, unknown>;
  if (
    typeof html !== 'string' ||
    !nonnegativeInteger(baseRevision) ||
    !nonnegativeInteger(generation) ||
    !nonnegativeInteger(savedAt) ||
    !nonnegativeInteger(expiresAt)
  )
    return null;
  return { html, baseRevision, generation, savedAt, expiresAt };
};

const DRAFT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DRAFT_MAX_ENTRY_BYTES = 256 * 1024;
const DRAFT_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const DRAFT_MAX_ENTRIES = 16;

const utf8Bytes = (value: string): number =>
  new TextEncoder().encode(value).length;

/**
 * One stored record's decision: a valid recovery copy, an expired copy, or
 * an invalid record DEC-271 refuses to recover. Byte, clock and revision
 * bounds all belong to the same read; shape validation alone is not enough.
 */
export type StoredDraftDecision =
  | { readonly ok: true; readonly draft: RecoveredDraft }
  | { readonly ok: false; readonly reason: 'invalid' | 'expired' };

const readStoredDraft = (
  raw: string,
  context: { readonly now: number; readonly serverRevision: number },
): StoredDraftDecision => {
  if (utf8Bytes(raw) > DRAFT_MAX_ENTRY_BYTES)
    return { ok: false, reason: 'invalid' };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  const draft = parseDraft(value);
  if (draft === null) return { ok: false, reason: 'invalid' };
  const retention = draft.expiresAt - draft.savedAt;
  if (
    draft.baseRevision > context.serverRevision ||
    draft.savedAt > context.now ||
    retention !== DRAFT_RETENTION_MS ||
    draft.expiresAt <= context.now
  )
    return draft.expiresAt <= context.now
      ? { ok: false, reason: 'expired' }
      : { ok: false, reason: 'invalid' };
  return { ok: true, draft };
};

/** A valid draft's storage accounting entry. */
type DraftEntry = {
  readonly key: string;
  readonly savedAt: number;
  readonly bytes: number;
};

/**
 * Chooses the oldest *other* drafts that must go for a new or replacement
 * write. A replacement never consumes a second slot or its own old bytes;
 * victims are only a plan — the I/O adapter removes them after a successful
 * write. A failed write leaves the old copies intact.
 */
const draftEvictionPlan = (
  entries: readonly DraftEntry[],
  input: {
    readonly addingBytes: number;
    readonly replacingKey: string | null;
    readonly addingEntry?: boolean;
  },
): readonly string[] => {
  const added = input.addingEntry === false ? 0 : 1;
  const others = entries.filter((entry) => entry.key !== input.replacingKey);
  const total = others.reduce((sum, entry) => sum + entry.bytes, 0);
  if (
    others.length + added <= DRAFT_MAX_ENTRIES &&
    total + input.addingBytes <= DRAFT_MAX_TOTAL_BYTES
  )
    return [];
  const ordered = [...others].sort((a, b) => a.savedAt - b.savedAt);
  const victims: string[] = [];
  let remaining = total;
  let count = others.length;
  for (const entry of ordered) {
    if (
      count + added <= DRAFT_MAX_ENTRIES &&
      remaining + input.addingBytes <= DRAFT_MAX_TOTAL_BYTES
    )
      break;
    victims.push(entry.key);
    remaining -= entry.bytes;
    count -= 1;
  }
  return victims;
};

const draftKey = (principalId: string, roundId: string, id: string) =>
  `daisy:round-notes:draft:${principalId}:${roundId}:${id}`;

/**
 * The keys that carry a draft, listed once so storage cannot be read or
 * purged with a second copy of the format.
 */
export const draftKeys = {
  getAll: (storage: DraftStorage): string[] => {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith('daisy:round-notes:draft:')) keys.push(key);
    }
    return keys;
  },
};

export type DocumentSync = {
  readonly dispose: (options?: { readonly purge?: boolean }) => void;
  readonly load: () => Promise<readonly StoredDocument[]>;
  readonly create: (
    folder: Exclude<FolderId, 'club'>,
    templateId: TemplateId,
  ) => Promise<StoredDocument>;
  /** Records an edit; it is saved once typing pauses. */
  readonly change: (id: string, html: string) => void;
  /** Saves every waiting edit now (leaving the page, Cmd+S). */
  readonly flush: () => Promise<void>;
  /** Pagehide variant: keepalive fetches within the 64 KiB budget. */
  readonly flushKeepalive: () => Promise<void>;
  /** Recovered drafts offered back to the room. */
  readonly recoveredDrafts: () => ReadonlyMap<string, RecoveredDraft>;
  /** Discards a recovered draft and any waiting edit behind it. */
  readonly restoreRecovered: (id: string) => void;
  readonly discardRecovered: (id: string) => boolean;
};

/** The longest wait between retries of a failed save. */
const MAX_RETRY_MS = 30_000;

/** The HTTP status a refused request carries, if any. */
const statusOf = (error: unknown): number | null => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
};

/** Network failures, timeouts, rate limits and server errors may pass later. */
const retryable = (status: number | null) =>
  status === null || status === 408 || status === 429 || status >= 500;

export type DocumentSyncResources = {
  readonly timers: Timers;
  readonly storage: DraftStorage | null;
  readonly budget: KeepaliveBudget;
  readonly wallClock: () => number;
};

export function createDocumentSync({
  api,
  roundId,
  onConflict,
  onChanged = () => {},
  onSaveFailed = () => {},
  onSaveRefused = () => {},
  onSaved = () => {},
  onRecoveredDraft = () => {},
  onDraftStorageFailed = () => {},
  delayMs = 1000,
  timers,
  storage,
  principalId,
  budget,
  wallClock,
}: DocumentSyncResources & {
  readonly api: DocumentsApi;
  readonly roundId: string;
  readonly principalId: string;
  readonly onConflict: (id: string) => void;
  readonly onChanged?: (id: string) => void;
  readonly onSaveFailed?: (id: string, attempts: number) => void;
  readonly onSaveRefused?: (id: string, status: number) => void;
  readonly onSaved?: (id: string) => void;
  readonly onRecoveredDraft?: (id: string, html: string) => void;
  readonly onDraftStorageFailed?: (id: string) => void;
  readonly delayMs?: number;
}): DocumentSync {
  let disposed = false;
  const revisions = new Map<string, number>();
  const waiting = new Map<string, string>();
  const generations = new Map<string, number>();
  const handles = new Map<string, unknown>();
  const saving = new Map<string, Promise<void>>();

  const remember = (docs: readonly StoredDocument[]) => {
    for (const doc of docs) revisions.set(doc.id, doc.revision);
    return docs;
  };

  const failures = new Map<string, number>();
  const refused = new Map<string, string>();

  const recovered = new Map<string, RecoveredDraft>();

  const schedule = (id: string, ms: number) => {
    timers.clear(handles.get(id));
    handles.set(
      id,
      timers.set(() => void saveNow(id), ms),
    );
  };

  const unanswered = new Map<string, Map<string, number>>();
  const conflicted = new Set<string>();

  const storageEntries = (now: number): DraftEntry[] => {
    if (!storage) return [];
    const entries: DraftEntry[] = [];
    for (const storedKey of draftKeys.getAll(storage)) {
      const raw = storage.getItem(storedKey);
      if (raw === null) continue;
      const decision = readStoredDraft(raw, {
        now,
        serverRevision: Number.MAX_SAFE_INTEGER,
      });
      if (!decision.ok) {
        storage.removeItem(storedKey);
        continue;
      }
      entries.push({
        key: storedKey,
        savedAt: decision.draft.savedAt,
        bytes: utf8Bytes(raw),
      });
    }
    return entries;
  };

  /**
   * Persists one durable generation. All storage operations are contained:
   * a failed or quota-rejected write leaves every unrelated valid draft
   * recoverable, reports the failure, and never stops the online save.
   */
  const persistDraft = (id: string, html: string) => {
    if (!storage) return;
    const baseRevision = revisions.get(id);
    if (baseRevision === undefined) return;
    const now = wallClock();
    const serialized = JSON.stringify({
      html: breakLines(html),
      baseRevision,
      generation: generations.get(id) ?? 0,
      savedAt: now,
      expiresAt: now + DRAFT_RETENTION_MS,
    } satisfies RecoveredDraft);
    const bytes = utf8Bytes(serialized);
    if (bytes > DRAFT_MAX_ENTRY_BYTES) {
      onDraftStorageFailed(id);
      return;
    }
    const key = draftKey(principalId, roundId, id);
    try {
      const entries = storageEntries(now);
      const victims = draftEvictionPlan(entries, {
        addingBytes: bytes,
        replacingKey: entries.some((entry) => entry.key === key) ? key : null,
      });
      // Web Storage writes are atomic. Never remove the previous target or
      // unrelated recovery copies to make room for a write that may fail.
      storage.setItem(key, serialized);
      for (const victim of victims) storage.removeItem(victim);
    } catch {
      onDraftStorageFailed(id);
    }
  };

  const clearDraft = (id: string, html?: string, generation?: number) => {
    if (!storage) return true;
    try {
      if (html !== undefined) {
        const raw = storage.getItem(draftKey(principalId, roundId, id));
        if (raw) {
          const parsed = parseDraft(JSON.parse(raw));
          if (
            !parsed ||
            !sameDocumentHtml(parsed.html, html) ||
            (generation !== undefined && parsed.generation !== generation)
          )
            return true;
        }
      }
      storage.removeItem(draftKey(principalId, roundId, id));
    } catch {
      onDraftStorageFailed(id);
      return false;
    }
    recovered.delete(id);
    return true;
  };

  const saved = (
    id: string,
    html: string,
    revision: number,
    generation: number,
  ) => {
    if (disposed) return;
    revisions.set(id, revision);
    failures.delete(id);
    unanswered.delete(id);
    let cleared = true;
    if (waiting.get(id) === html && generations.get(id) === generation) {
      waiting.delete(id);
      cleared = clearDraft(id, html, generation);
    } else {
      // A later edit was typed while this one was in flight. Rebase its
      // durable generation to the acknowledged revision, then send it; the
      // room stays unsaved until that newer edit is acknowledged too.
      const later = waiting.get(id);
      if (later !== undefined) persistDraft(id, later);
    }
    if (cleared && waiting.size === 0 && recovered.size === 0) onSaved(id);
  };

  const ownCommit = async (id: string, revision: number) => {
    const sent = unanswered.get(id);
    if (!sent || revision !== (revisions.get(id) ?? 0) + 1) return null;
    const doc = (await api.list(roundId)).find((one) => one.id === id);
    if (!doc || doc.revision !== revision) return null;
    const match = [...sent].find(([html]) => sameDocumentHtml(doc.html, html));
    return match ? { html: match[0], generation: match[1] } : null;
  };

  const conflict = async (id: string, revision: number) => {
    const html = await ownCommit(id, revision);
    if (disposed) return;
    if (html === null) {
      conflicted.add(id);
      onConflict(id);
      return;
    }
    saved(id, html.html, revision, html.generation);
  };

  const failed = (
    id: string,
    html: string,
    generation: number,
    error: unknown,
  ) => {
    if (disposed) return;
    const status = statusOf(error);
    if (status !== null && !retryable(status)) {
      refused.set(id, html);
      onSaveRefused(id, status);
      return;
    }
    unanswered.set(id, (unanswered.get(id) ?? new Map()).set(html, generation));
    const attempts = (failures.get(id) ?? 0) + 1;
    failures.set(id, attempts);
    onSaveFailed(id, attempts);
    schedule(id, Math.min(delayMs * 2 ** attempts, MAX_RETRY_MS));
  };

  function attempt(id: string, keepalive = false): Promise<void> | undefined {
    if (disposed) return;
    const html = waiting.get(id);
    const expectedRevision = revisions.get(id);
    if (html === undefined || expectedRevision === undefined) return;
    if (refused.get(id) === html || conflicted.has(id)) return;
    const generation = generations.get(id) ?? 0;
    const body = { id, html, expectedRevision };
    const reservation = keepalive ? budget.reserve(body) : null;
    if (reservation === null && keepalive) {
      persistDraft(id, html);
      return;
    }
    const request = keepalive
      ? { ...body, keepalive: true }
      : { id, html, expectedRevision };
    const acknowledged = api
      .save(request)
      .then((result) =>
        result.status === 'saved'
          ? saved(id, html, result.revision, generation)
          : conflict(id, result.revision),
      )
      .catch((error: unknown) => {
        failed(id, html, generation, error);
        return false as const;
      });
    return acknowledged
      .finally(() => reservation?.release())
      .then((settled) =>
        settled === false
          ? undefined
          : // A newer edit typed while this request was in flight is rebased by
            // `saved`; send it now, exactly once, on the acknowledged revision.
            waiting.has(id)
            ? attempt(id)
            : undefined,
      );
  }

  function saveNow(id: string, keepalive = false): Promise<void> {
    const run = (saving.get(id) ?? Promise.resolve()).then(() =>
      attempt(id, keepalive),
    );
    saving.set(id, run);
    return run;
  }

  return {
    dispose: ({ purge = false } = {}) => {
      disposed = true;
      for (const handle of handles.values()) timers.clear(handle);
      handles.clear();
      waiting.clear();
      recovered.clear();
      if (!purge || !storage) return;
      try {
        for (const key of draftKeys.getAll(storage))
          if (key.startsWith(`daisy:round-notes:draft:${principalId}:`))
            storage.removeItem(key);
      } catch {
        onDraftStorageFailed('');
      }
    },
    load: async () => {
      if (disposed) return [];
      const docs = remember(await api.list(roundId));
      if (disposed) return [];
      const now = wallClock();
      try {
        const excess = draftEvictionPlan(storageEntries(now), {
          addingBytes: 0,
          replacingKey: null,
          addingEntry: false,
        });
        for (const key of excess) storage?.removeItem(key);
      } catch {
        onDraftStorageFailed(docs[0]?.id ?? '');
        return docs;
      }
      for (const doc of docs) {
        if (!storage) continue;
        let raw: string | null;
        try {
          raw = storage.getItem(draftKey(principalId, roundId, doc.id));
        } catch {
          onDraftStorageFailed(doc.id);
          continue;
        }
        if (raw === null) continue;
        const decision = readStoredDraft(raw, {
          now,
          serverRevision: doc.revision,
        });
        if (!decision.ok) {
          try {
            storage.removeItem(draftKey(principalId, roundId, doc.id));
          } catch {
            onDraftStorageFailed(doc.id);
          }
          continue;
        }
        const draft = decision.draft;
        recovered.set(doc.id, draft);
        generations.set(doc.id, draft.generation);
        // Recovery remains a separate choice, including exact-base drafts.
        // Only an explicit Restore may put its HTML in the editor/save queue.
        onRecoveredDraft(doc.id, draft.html);
      }
      return docs;
    },
    create: async (folder, templateId) => {
      if (disposed) throw new Error('The document owner is no longer active.');
      const doc = await api.create({ roundId, folder, templateId });
      remember([doc]);
      return doc;
    },
    change,
    restoreRecovered: (id) => {
      const draft = recovered.get(id);
      if (!draft || disposed) return;
      recovered.delete(id);
      change(id, draft.html);
    },
    discardRecovered: (id) => {
      const draft = recovered.get(id);
      if (!draft || disposed) return false;
      // Loading never queues recovery. New typing has its own generation;
      // removing an older offer must not touch that edit or its timer.
      const cleared = clearDraft(id, draft.html, draft.generation);
      if (cleared) recovered.delete(id);
      return cleared;
    },
    flush: () => flushNormal(),
    flushKeepalive: () => flushWithKeepalive(),
    recoveredDrafts: () => new Map(recovered),
  };

  function change(id: string, html: string) {
    if (disposed || !revisions.has(id)) return;
    generations.set(id, (generations.get(id) ?? 0) + 1);
    waiting.set(id, html);
    onChanged(id);
    if (!storage) onDraftStorageFailed(id);
    else persistDraft(id, html);
    schedule(id, delayMs);
  }

  async function flushNormal(): Promise<void> {
    for (const handle of handles.values()) timers.clear(handle);
    handles.clear();
    await Promise.all([...waiting.keys()].map((id) => saveNow(id)));
  }

  async function flushWithKeepalive(): Promise<void> {
    for (const handle of handles.values()) timers.clear(handle);
    handles.clear();
    // Persist every waiting edit first, so recovery survives a close. The
    // budget is reserved from the exact immutable body only when each send
    // reaches the API, after any earlier save has rebased its revision.
    for (const [id, html] of waiting) persistDraft(id, html);
    await Promise.all([...waiting.keys()].map((id) => saveNow(id, true)));
  }
}
