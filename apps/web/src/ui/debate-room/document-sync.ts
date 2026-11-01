import { sameDocumentHtml } from '../../features/documents/document-lines';
import { systemClock } from '@daisy/clock';
import z from 'zod';
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

const browserTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Minimal storage seam; defaults to window.localStorage when available. */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type RecoveredDraft = {
  readonly html: string;
  readonly baseRevision: number;
  readonly savedAt: number;
  readonly expiresAt: number;
};

const recoveredDraftSchema = z.object({
  html: z.string(),
  baseRevision: z.number().int().min(0),
  savedAt: z.number().int().min(0),
  expiresAt: z.number().int().min(0),
});
const parseDraft = (value: unknown): RecoveredDraft | null => {
  const parsed = recoveredDraftSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
};

const KEEPALIVE_BODY_BUDGET = 64 * 1024;

const defaultStorage = (): DraftStorage | null => {
  try {
    if (typeof window !== 'undefined' && window.localStorage)
      return window.localStorage;
  } catch {
    return null;
  }
  return null;
};

const draftKey = (principalId: string, roundId: string, id: string) =>
  `daisy:round-notes:draft:${principalId}:${roundId}:${id}`;

export type DocumentSync = {
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
  readonly discardRecovered: (id: string) => void;
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

export function createDocumentSync({
  api,
  roundId,
  onConflict,
  onSaveFailed = () => {},
  onSaveRefused = () => {},
  onSaved = () => {},
  onRecoveredDraft = () => {},
  onDraftStorageFailed = () => {},
  delayMs = 1000,
  timers = browserTimers,
  storage = defaultStorage(),
  principalId,
  wallClock = () => Date.parse(systemClock.now()),
}: {
  readonly api: DocumentsApi;
  readonly roundId: string;
  readonly principalId: string;
  readonly onConflict: (id: string) => void;
  readonly onSaveFailed?: (id: string, attempts: number) => void;
  readonly onSaveRefused?: (id: string, status: number) => void;
  readonly onSaved?: (id: string) => void;
  readonly onRecoveredDraft?: (id: string, html: string) => void;
  readonly onDraftStorageFailed?: (id: string) => void;
  readonly delayMs?: number;
  readonly timers?: Timers;
  readonly storage?: DraftStorage | null;
  /** The absolute wall-clock source for persisted draft expiry/eviction. */
  readonly wallClock?: () => number;
}): DocumentSync {
  const revisions = new Map<string, number>();
  const waiting = new Map<string, string>();
  const handles = new Map<string, unknown>();
  const saving = new Map<string, Promise<void>>();

  const remember = (docs: readonly StoredDocument[]) => {
    for (const doc of docs) revisions.set(doc.id, doc.revision);
    return docs;
  };

  const failures = new Map<string, number>();
  const refused = new Map<string, string>();

  const recovered = new Map<string, RecoveredDraft>();

  /** Reserved body bytes across outstanding keepalive sends. */
  let keepaliveReserved = 0;
  const reservePool = new Map<string, number>();

  const schedule = (id: string, ms: number) => {
    timers.clear(handles.get(id));
    handles.set(
      id,
      timers.set(() => void saveNow(id), ms),
    );
  };

  const unanswered = new Map<string, Set<string>>();
  const conflicted = new Set<string>();

  const DRAFT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
  const DRAFT_MAX_ENTRY_BYTES = 256 * 1024;
  const DRAFT_MAX_TOTAL_BYTES = 4 * 1024 * 1024;
  const DRAFT_MAX_ENTRIES = 16;

  const evictDrafts = (adding: number) => {
    if (!storage) return;
    const now = wallClock();
    const entries: { key: string; savedAt: number; size: number }[] = [];
    let total = 0;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !key.startsWith('daisy:round-notes:draft:')) continue;
      const raw = storage.getItem(key);
      if (!raw) continue;
      let parsed: RecoveredDraft | null = null;
      try {
        parsed = parseDraft(JSON.parse(raw));
      } catch {
        storage.removeItem(key);
        continue;
      }
      if (!parsed || parsed.expiresAt < now) {
        storage.removeItem(key);
        continue;
      }
      const size = new TextEncoder().encode(raw).length;
      entries.push({ key, savedAt: parsed.savedAt, size });
      total += size;
    }
    // Evict oldest until within bounds.
    entries.sort((a, b) => a.savedAt - b.savedAt);
    let index = 0;
    while (
      (entries.length - index > DRAFT_MAX_ENTRIES - 1 ||
        total + adding > DRAFT_MAX_TOTAL_BYTES) &&
      index < entries.length
    ) {
      const victim = entries[index++];
      storage.removeItem(victim.key);
      total -= victim.size;
    }
  };

  const persistDraft = (id: string, html: string) => {
    if (!storage) return;
    const baseRevision = revisions.get(id);
    if (baseRevision === undefined) return;
    const now = wallClock();
    const serialized = JSON.stringify({
      html,
      baseRevision,
      savedAt: now,
      expiresAt: now + DRAFT_RETENTION_MS,
    } satisfies RecoveredDraft);
    const bytes = new TextEncoder().encode(serialized).length;
    if (bytes > DRAFT_MAX_ENTRY_BYTES) {
      onDraftStorageFailed(id);
      return;
    }
    evictDrafts(bytes);
    try {
      storage.setItem(draftKey(principalId, roundId, id), serialized);
    } catch {
      onDraftStorageFailed(id);
    }
  };

  const clearDraft = (id: string, html?: string) => {
    if (!storage) return;
    try {
      if (html !== undefined) {
        const raw = storage.getItem(draftKey(principalId, roundId, id));
        if (raw) {
          const parsed = parseDraft(JSON.parse(raw));
          if (parsed.html !== html) return;
        }
      }
      storage.removeItem(draftKey(principalId, roundId, id));
    } catch {
      /* ignore */
    }
    recovered.delete(id);
  };

  const saved = (id: string, html: string, revision: number) => {
    revisions.set(id, revision);
    failures.delete(id);
    unanswered.delete(id);
    if (waiting.get(id) === html) waiting.delete(id);
    clearDraft(id, html);
    onSaved(id);
  };

  const ownCommit = async (id: string, revision: number) => {
    const sent = unanswered.get(id);
    if (!sent || revision !== (revisions.get(id) ?? 0) + 1) return null;
    const doc = (await api.list(roundId)).find((one) => one.id === id);
    if (!doc || doc.revision !== revision) return null;
    return [...sent].find((html) => sameDocumentHtml(doc.html, html)) ?? null;
  };

  const conflict = async (id: string, revision: number) => {
    const html = await ownCommit(id, revision);
    if (html === null) {
      conflicted.add(id);
      onConflict(id);
      return;
    }
    saved(id, html, revision);
    return attempt(id);
  };

  const failed = (id: string, html: string, error: unknown) => {
    const status = statusOf(error);
    if (status !== null && !retryable(status)) {
      refused.set(id, html);
      onSaveRefused(id, status);
      return;
    }
    unanswered.set(id, (unanswered.get(id) ?? new Set()).add(html));
    const attempts = (failures.get(id) ?? 0) + 1;
    failures.set(id, attempts);
    onSaveFailed(id, attempts);
    schedule(id, Math.min(delayMs * 2 ** attempts, MAX_RETRY_MS));
  };

  function attempt(id: string, keepalive = false): Promise<void> | undefined {
    const html = waiting.get(id);
    const expectedRevision = revisions.get(id);
    if (html === undefined || expectedRevision === undefined) return;
    if (refused.get(id) === html || conflicted.has(id)) return;
    const request = keepalive
      ? { id, html, expectedRevision, keepalive: true }
      : { id, html, expectedRevision };
    return api
      .save(request)
      .then((result) =>
        result.status === 'saved'
          ? saved(id, html, result.revision)
          : conflict(id, result.revision),
      )
      .catch((error: unknown) => failed(id, html, error));
  }

  function releaseReservation(id: string): void {
    keepaliveReserved -= reservePool.get(id) ?? 0;
    reservePool.delete(id);
  }

  function saveNow(id: string, keepalive = false): Promise<void> {
    const run = (saving.get(id) ?? Promise.resolve())
      .then(() => attempt(id, keepalive))
      .finally(() => {
        if (keepalive) releaseReservation(id);
      });
    saving.set(id, run);
    return run;
  }

  return {
    load: async () => {
      const docs = remember(await api.list(roundId));
      for (const doc of docs) {
        if (!storage) continue;
        let draft: RecoveredDraft | null = null;
        try {
          const raw = storage.getItem(draftKey(principalId, roundId, doc.id));
          if (raw) draft = parseDraft(JSON.parse(raw));
        } catch {
          draft = null;
        }
        if (!draft) continue;
        // Expired drafts are dropped.
        if (draft.expiresAt < wallClock()) {
          clearDraft(doc.id);
          continue;
        }
        recovered.set(doc.id, draft);
        // Never silently overwrite a newer server document: only queue the
        // draft for saving when it is based on the current or newer revision;
        // otherwise keep it recoverable for explicit conflict resolution.
        if (draft.baseRevision === doc.revision) {
          waiting.set(doc.id, draft.html);
        }
        onRecoveredDraft(doc.id, draft.html);
      }
      return docs;
    },
    create: async (folder, templateId) => {
      const doc = await api.create({ roundId, folder, templateId });
      remember([doc]);
      return doc;
    },
    change: (id, html) => {
      waiting.set(id, html);
      if (!storage) onDraftStorageFailed(id);
      else persistDraft(id, html);
      schedule(id, delayMs);
    },
    discardRecovered: (id) => {
      recovered.delete(id);
      waiting.delete(id);
      clearDraft(id);
      handles.delete(id);
      failures.delete(id);
      refused.delete(id);
      conflicted.delete(id);
      unanswered.delete(id);
      reservePool.delete(id);
    },
    flush: () => flushNormal(),
    flushKeepalive: () => flushWithKeepalive(),
    recoveredDrafts: () => new Map(recovered),
  };

  async function flushNormal(): Promise<void> {
    for (const handle of handles.values()) timers.clear(handle);
    handles.clear();
    await Promise.all([...waiting.keys()].map((id) => saveNow(id)));
  }

  async function flushWithKeepalive(): Promise<void> {
    for (const handle of handles.values()) timers.clear(handle);
    handles.clear();
    // Persist every waiting edit first, so recovery survives a close.
    for (const [id, html] of waiting) persistDraft(id, html);
    // Keep combined keepalive request bodies within the browser budget.
    const ids = [...waiting.keys()];
    const toSend: string[] = [];
    let budget = KEEPALIVE_BODY_BUDGET - keepaliveReserved;
    for (const id of ids) {
      const html = waiting.get(id);
      const expectedRevision = revisions.get(id);
      if (html === undefined || expectedRevision === undefined) continue;
      if (conflicted.has(id)) continue;
      const bodySize =
        new TextEncoder().encode(JSON.stringify({ id, html, expectedRevision }))
          .length + 64;
      if (bodySize <= budget) {
        toSend.push(id);
        reservePool.set(id, bodySize);
        keepaliveReserved += bodySize;
        budget -= bodySize;
      } else {
        persistDraft(id, html);
      }
    }
    // The reservation releases as each send settles; the overlap test
    // below uses the exhaustive budget to expose it.
    const settled = toSend.map((id) => saveNow(id, true));
    await Promise.all(settled);
  }
}
