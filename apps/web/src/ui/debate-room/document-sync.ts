import type {
  FolderId,
  TemplateId,
  WorkspaceDocument,
} from '../../features/debate-room/documents';

export type StoredDocument = WorkspaceDocument & { readonly revision: number };

export type SaveResult =
  | { readonly status: 'saved'; readonly revision: number }
  | { readonly status: 'conflict'; readonly revision: number };

/** The server's document routes, as the room calls them. */
export type DocumentsApi = {
  readonly list: (aiDebateId: string) => Promise<readonly StoredDocument[]>;
  readonly create: (input: {
    readonly aiDebateId: string;
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

/**
 * Saves each document once typing pauses, against the revision it was
 * read at. A conflict (another tab saved first) is handed to `onConflict`
 * with nothing overwritten; the room then reloads the server's copy. A
 * failed save keeps the edit waiting and retries with a growing delay;
 * `onSaveFailed` and `onSaved` let the room say so.
 */
export function createDocumentSync({
  api,
  aiDebateId,
  onConflict,
  onSaveFailed = () => {},
  onSaved = () => {},
  delayMs = 1000,
  timers = browserTimers,
}: {
  readonly api: DocumentsApi;
  readonly aiDebateId: string;
  readonly onConflict: (id: string) => void;
  readonly onSaveFailed?: (id: string, attempts: number) => void;
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

  const schedule = (id: string, ms: number) => {
    timers.clear(handles.get(id));
    handles.set(
      id,
      timers.set(() => void saveNow(id), ms),
    );
  };

  const saved = (id: string, html: string, result: SaveResult) => {
    revisions.set(id, result.revision);
    failures.delete(id);
    // An edit typed while this one was in flight stays waiting.
    if (waiting.get(id) === html) waiting.delete(id);
    if (result.status === 'conflict') {
      waiting.delete(id);
      onConflict(id);
      return;
    }
    onSaved(id);
  };

  const failed = (id: string) => {
    const attempts = (failures.get(id) ?? 0) + 1;
    failures.set(id, attempts);
    onSaveFailed(id, attempts);
    schedule(id, Math.min(delayMs * 2 ** attempts, MAX_RETRY_MS));
  };

  /** One save per document at a time: each waits for the one before it. */
  function saveNow(id: string): Promise<void> {
    const run = (saving.get(id) ?? Promise.resolve()).then(() => {
      const html = waiting.get(id);
      const expectedRevision = revisions.get(id);
      if (html === undefined || expectedRevision === undefined) return;
      // Never rejects: a failure keeps the edit waiting and retries later.
      return api.save({ id, html, expectedRevision }).then(
        (result) => saved(id, html, result),
        () => failed(id),
      );
    });
    saving.set(id, run);
    return run;
  }

  return {
    load: async () => remember(await api.list(aiDebateId)),
    create: async (folder, templateId) => {
      const doc = await api.create({ aiDebateId, folder, templateId });
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
