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

/**
 * Saves each document once typing pauses, against the revision it was
 * read at. A conflict (another tab saved first) is handed to `onConflict`
 * with nothing overwritten; the room then reloads the server's copy.
 */
export function createDocumentSync({
  api,
  aiDebateId,
  onConflict,
  delayMs = 1000,
  timers = browserTimers,
}: {
  readonly api: DocumentsApi;
  readonly aiDebateId: string;
  readonly onConflict: (id: string) => void;
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

  const saveNow = async (id: string): Promise<void> => {
    await saving.get(id);
    const html = waiting.get(id);
    const expectedRevision = revisions.get(id);
    if (html === undefined || expectedRevision === undefined) return;
    waiting.delete(id);
    const run = api.save({ id, html, expectedRevision }).then((result) => {
      revisions.set(id, result.revision);
      if (result.status === 'conflict') {
        waiting.delete(id);
        onConflict(id);
      }
    });
    saving.set(id, run);
    await run;
  };

  return {
    load: async () => remember(await api.list(aiDebateId)),
    create: async (folder, templateId) => {
      const doc = await api.create({ aiDebateId, folder, templateId });
      remember([doc]);
      return doc;
    },
    change: (id, html) => {
      waiting.set(id, html);
      timers.clear(handles.get(id));
      handles.set(
        id,
        timers.set(() => void saveNow(id), delayMs),
      );
    },
    flush: async () => {
      for (const handle of handles.values()) timers.clear(handle);
      handles.clear();
      await Promise.all([...waiting.keys()].map(saveNow));
    },
  };
}
