import { sameDocumentHtml } from '../../features/debate-room/documents/document-lines';
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

/**
 * Saves each document once typing pauses, against the revision it was
 * read at. A 409 after a save that got no answer may be that save, which
 * the server committed: if the server holds it at the next revision, the
 * sync adopts that revision and sends what was typed since. Any other
 * conflict (another tab saved first) is handed to `onConflict` with
 * nothing overwritten and the local edit left in place; that document is
 * not saved again until the room reloads. A
 * failed save keeps the edit waiting and retries with a growing delay; a
 * refusal that cannot pass later (invalid, too large, signed out) is not
 * retried until the debater edits again. `onSaveFailed`, `onSaveRefused`
 * and `onSaved` let the room say so.
 */
export function createDocumentSync({
  api,
  roundId,
  onConflict,
  onSaveFailed = () => {},
  onSaveRefused = () => {},
  onSaved = () => {},
  delayMs = 1000,
  timers = browserTimers,
}: {
  readonly api: DocumentsApi;
  readonly roundId: string;
  readonly onConflict: (id: string) => void;
  readonly onSaveFailed?: (id: string, attempts: number) => void;
  readonly onSaveRefused?: (id: string, status: number) => void;
  readonly onSaved?: (id: string) => void;
  readonly delayMs?: number;
  readonly timers?: Timers;
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
  /** The edit the server refused, per document; never sent again as is. */
  const refused = new Map<string, string>();

  const schedule = (id: string, ms: number) => {
    timers.clear(handles.get(id));
    handles.set(
      id,
      timers.set(() => void saveNow(id), ms),
    );
  };

  /** Saves sent at the current revision that got no answer; the server may hold one. */
  const unanswered = new Map<string, Set<string>>();
  /** Documents another writer changed; not saved again until reload. */
  const conflicted = new Set<string>();

  const saved = (id: string, html: string, revision: number) => {
    revisions.set(id, revision);
    failures.delete(id);
    unanswered.delete(id);
    // An edit typed while this one was in flight stays waiting.
    if (waiting.get(id) === html) waiting.delete(id);
    onSaved(id);
  };

  /** The server's copy, when it is one of our unanswered saves at the next revision. */
  const ownCommit = async (id: string, revision: number) => {
    const sent = unanswered.get(id);
    if (!sent || revision !== (revisions.get(id) ?? 0) + 1) return null;
    const doc = (await api.list(roundId)).find((one) => one.id === id);
    if (!doc || doc.revision !== revision) return null;
    return [...sent].find((html) => sameDocumentHtml(doc.html, html)) ?? null;
  };

  /** A 409: adopt our own committed save and send what follows, or report it. */
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
    // No answer, or a failure after the server may have committed it.
    unanswered.set(id, (unanswered.get(id) ?? new Set()).add(html));
    const attempts = (failures.get(id) ?? 0) + 1;
    failures.set(id, attempts);
    onSaveFailed(id, attempts);
    schedule(id, Math.min(delayMs * 2 ** attempts, MAX_RETRY_MS));
  };

  /** Sends the waiting edit, if there is one to send. */
  function attempt(id: string): Promise<void> | undefined {
    const html = waiting.get(id);
    const expectedRevision = revisions.get(id);
    if (html === undefined || expectedRevision === undefined) return;
    if (refused.get(id) === html || conflicted.has(id)) return;
    // Never rejects: a failure keeps the edit waiting and retries later.
    return api
      .save({ id, html, expectedRevision })
      .then((result) =>
        result.status === 'saved'
          ? saved(id, html, result.revision)
          : conflict(id, result.revision),
      )
      .catch((error: unknown) => failed(id, html, error));
  }

  /** One save per document at a time: each waits for the one before it. */
  function saveNow(id: string): Promise<void> {
    const run = (saving.get(id) ?? Promise.resolve()).then(() => attempt(id));
    saving.set(id, run);
    return run;
  }

  return {
    load: async () => remember(await api.list(roundId)),
    create: async (folder, templateId) => {
      const doc = await api.create({ roundId, folder, templateId });
      remember([doc]);
      return doc;
    },
    change: (id, html) => {
      waiting.set(id, html);
      schedule(id, delayMs);
    },
    flush: async () => {
      for (const handle of handles.values()) timers.clear(handle);
      handles.clear();
      await Promise.all([...waiting.keys()].map(saveNow));
    },
  };
}
