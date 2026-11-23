import type { ManagerAction } from '../../features/documents/document-manager-state';
import {
  findOpen,
  loadedDocuments,
  type OpenDocument,
} from '../../features/documents/open-documents';
import {
  DRIVE_FULL_NOTICE,
  driveNotices,
} from '../../features/documents/drive-return';
import type {
  DriveCursor,
  DriveEntryView,
} from '../../features/documents/drive-tree';
import type { DocumentSync, StoredDocument } from './document-sync';
import type { SaveState } from './document-pane';
import type {
  driveApi as browserDriveApi,
  DriveChange,
  FolderRow,
  RecentDocument,
} from './drive-api';
import type { createDriveOperations } from './drive-operations';

/** What went wrong last, by who may clear it. */
type DriveProblem =
  | {
      readonly kind: 'read';
      readonly resourceId: string | null;
      readonly message: string;
    }
  | { readonly kind: 'change' | 'missing'; readonly message: string };

/** What the drive shows besides its tree, which the manager's reducer holds. */
export type DriveSnapshot = {
  readonly folders: readonly FolderRow[];
  readonly problem: DriveProblem | null;
  readonly folderProblem: string | null;
  readonly recent: readonly RecentDocument[];
};

export const seedDrive = (
  folders: readonly FolderRow[],
  recent: readonly RecentDocument[] | undefined,
): DriveSnapshot => ({
  folders,
  problem: null,
  folderProblem: null,
  recent: recent ?? [],
});

/** The manager's current document owner and its operation sequence. */
export type DriveOwner = {
  readonly sync: DocumentSync | undefined;
  readonly scope: ReturnType<typeof createDriveOperations>;
};

// At most 20 sidebar requests per minute leaves room in the shared Recent
// bucket for sync.load and another tab. The final save always gets a refresh.
const RECENT_INTERVAL_MS = 3_000;

const statusOf = (error: unknown) =>
  (error as { readonly status?: unknown } | null)?.status;
const orNull = (value: string | undefined) => (value ? value : null);

/**
 * One manager's drive: its folder destinations, Recent, and the notice for
 * what went wrong, with every read and change the manager asks for. The tree
 * changes only once the authenticated document operation has agreed, and an
 * older read never lands over a change acknowledged after it began.
 */
export function createDriveDriver(ports: {
  readonly seed: DriveSnapshot;
  /** Whether a seeded Recent skips its first refresh. */
  readonly recentSeeded: boolean;
  readonly api: Pick<
    typeof browserDriveApi,
    'list' | 'change' | 'folders' | 'hasDocument' | 'folderCount' | 'recent'
  >;
  /** The owner now: operations run in its sequence, while it owns them. */
  readonly owner: () => DriveOwner;
  readonly opened: () => readonly OpenDocument[];
  readonly dispatch: (action: ManagerAction) => void;
  /** Whether the frame lists Recent now. */
  readonly showRecent: () => boolean;
  /** The instant now, as an ISO string, for a renamed row. */
  readonly now: () => string;
  /** Milliseconds now, for pacing Recent. */
  readonly clockMs: () => number;
  readonly after: (run: () => void, ms: number) => () => void;
}) {
  const { api } = ports;
  const listeners = new Set<() => void>();
  let snapshot = ports.seed;
  /** Moves on with every change, so a read begun before one never lands. */
  let generation = 0;
  // Expansion and New here share the first read, so an older response cannot
  // arrive after the create and replace its newly inserted row.
  const firstPages = new Map<string | null, Promise<void>>();
  let recentGeneration = 0;
  let recentStarted = -Infinity;
  let recentWait: (() => void) | null = null;
  let recentSeeded = ports.recentSeeded;

  const publish = (next: Partial<DriveSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  };
  const setProblem = (
    next: (current: DriveProblem | null) => DriveProblem | null,
  ) => {
    const problem = next(snapshot.problem);
    if (problem !== snapshot.problem) publish({ problem });
  };
  /** A bounded, ordered read of Recent; a failed refresh keeps the last good list. */
  const readRecent = () => {
    if (!ports.showRecent()) return;
    recentGeneration++;
    const read = () => {
      recentWait = null;
      recentStarted = ports.clockMs();
      const requested = recentGeneration;
      api.recent().then(
        (found) => {
          if (requested === recentGeneration) publish({ recent: found });
        },
        () => {},
      );
    };
    const waitMs = Math.max(
      0,
      RECENT_INTERVAL_MS - (ports.clockMs() - recentStarted),
    );
    if (waitMs === 0) {
      recentWait?.();
      recentWait = null;
      read();
    } else if (recentWait === null) recentWait = ports.after(read, waitMs);
  };

  /** A row the server no longer has; `sync` is the owner that found it gone. */
  const missing = (id: string, sync = ports.owner().sync) => {
    generation++;
    ports.dispatch({ type: 'drive/unlist', id });
    readRecent();
    // A stale row may be an open document, or a folder with open descendants.
    // Recheck server truth without throwing away anyone's unsaved text.
    void sync
      ?.recheck(loadedDocuments(ports.opened()).map((document) => document.id))
      .catch(() => {});
  };
  const readFailed = (
    error: unknown,
    resourceId: string | null,
    message: string,
    passive = false,
  ) => {
    if (statusOf(error) === 404 && resourceId !== null) missing(resourceId);
    setProblem((current) =>
      passive && (current?.kind === 'change' || current?.kind === 'missing')
        ? current
        : statusOf(error) === 404
          ? { kind: 'missing', message: driveNotices.missing }
          : { kind: 'read', resourceId, message },
    );
  };
  /** A change in `scope`'s sequence; while it still owns it, a change notice ends. */
  const mutate = async <T>(
    scope: DriveOwner['scope'],
    run: () => Promise<T>,
  ): Promise<T> => {
    generation++;
    const answer = await run();
    if (scope.owns()) {
      generation++;
      setProblem((current) =>
        current?.kind === 'change' || current?.kind === 'missing'
          ? null
          : current,
      );
    }
    return answer;
  };
  const readSucceeded = (folderId: string | null, explicit: boolean) =>
    setProblem((current) =>
      (current?.kind === 'missing' && explicit) ||
      (current?.kind === 'read' && current.resourceId === folderId)
        ? null
        : current,
    );

  const listFolder = (
    folderId: string | null,
    after: DriveCursor | null,
    passive = false,
  ): Promise<void> => {
    const pending = after === null ? firstPages.get(folderId) : undefined;
    if (pending)
      return passive
        ? pending
        : pending.then(() => readSucceeded(folderId, true));
    const request = async (): Promise<void> => {
      const started = generation;
      const page = await api.list(folderId, after);
      // A focus refresh may race a create, rename, move or deletion. Never
      // replace an acknowledged change with a page read before it committed.
      if (started !== generation) return request();
      readSucceeded(folderId, !passive);
      ports.dispatch({
        type: 'drive/page',
        folderId,
        first: after === null,
        ...page,
      });
    };
    const read = request();
    if (after !== null) return read;
    const tracked = read.finally(() => firstPages.delete(folderId));
    firstPages.set(folderId, tracked);
    return tracked;
  };

  // Automatic reads can recover their own read errors, but never consume
  // the person's actionable missing-item or change message.
  const readRoot = () =>
    void listFolder(null, null, true).catch((error) =>
      readFailed(
        error,
        null,
        'Your drive did not load. Reload the page.',
        true,
      ),
    );

  const createDocument = (folderId: string | null) => {
    const { sync, scope } = ports.owner();
    if (!sync || !scope.beginCreate()) return;
    void scope.run(() =>
      mutate(scope, () => sync.create(folderId))
        .then((document) => {
          if (!scope.owns()) return;
          ports.dispatch({ type: 'doc/add', document });
          const entry: DriveEntryView = {
            kind: 'document',
            id: document.id,
            title: document.title,
          };
          ports.dispatch({ type: 'drive/add', folderId, entry });
        })
        .catch((error: unknown) => {
          if (!scope.owns()) return;
          if (statusOf(error) === 404 && folderId !== null)
            missing(folderId, sync);
          setProblem(() => ({
            kind: statusOf(error) === 404 ? 'missing' : 'change',
            message:
              statusOf(error) === 409
                ? DRIVE_FULL_NOTICE
                : statusOf(error) === 404
                  ? driveNotices.missing
                  : 'That document was not created. Try again.',
          }));
        })
        .finally(() => {
          scope.endCreate();
          if (scope.owns()) readRecent();
        }),
    );
  };

  const change = (
    path: DriveChange,
    fields: Readonly<Record<string, string>>,
  ) => {
    if (path === 'create') return createDocument(orNull(fields.folderId));
    const { sync, scope } = ports.owner();
    const id = fields.id ?? '';
    const body =
      path === 'move'
        ? { id, folderId: orNull(fields.folderId) }
        : path === 'folders/move'
          ? { id, parentFolderId: orNull(fields.parentFolderId) }
          : path === 'folders/create'
            ? {
                parentFolderId: orNull(fields.parentFolderId),
                name: fields.name ?? '',
              }
            : fields;
    void scope.run(() =>
      mutate(scope, () =>
        api.change<{
          folder?: DriveEntryView;
          deletedDocumentIds?: readonly string[];
        }>(path, body),
      )
        .then((answer) => {
          if (!scope.owns()) return;
          if (path === 'rename' || path === 'folders/rename')
            ports.dispatch({
              type: 'drive/rename',
              id,
              label: (fields.title ?? fields.name ?? '').trim(),
              now: ports.now(),
            });
          else if (path === 'move')
            ports.dispatch({
              type: 'drive/move',
              id,
              folderId: orNull(fields.folderId),
            });
          else if (path === 'folders/move')
            ports.dispatch({
              type: 'drive/move',
              id,
              folderId: orNull(fields.parentFolderId),
            });
          else if (path === 'delete') {
            sync?.forget(id);
            ports.dispatch({ type: 'drive/remove', id });
          } else if (path === 'folders/delete') {
            const documentIds = answer.deletedDocumentIds ?? [];
            sync?.forgetAll(documentIds);
            ports.dispatch({ type: 'drive/folder-deleted', id, documentIds });
          } else if (answer.folder) {
            // The one path left is folders/create, the only one answering a folder.
            ports.dispatch({
              type: 'drive/add',
              folderId: orNull(fields.parentFolderId),
              entry: answer.folder,
            });
            ports.dispatch({ type: 'drive/renaming', id: answer.folder.id });
          }
          readRecent();
        })
        .catch(async (error: unknown) => {
          if (!scope.owns()) return;
          if (
            statusOf(error) === 404 &&
            (path === 'move' || path === 'folders/move')
          ) {
            try {
              const found = await api.folders();
              if (!scope.owns()) return;
              publish({ folders: found, folderProblem: null });
              const sourceExists =
                path === 'folders/move'
                  ? found.some((folder) => folder.id === id)
                  : await api.hasDocument(id);
              if (!scope.owns()) return;
              const targetId = orNull(
                path === 'move' ? fields.folderId : fields.parentFolderId,
              );
              const targetExists =
                targetId === null ||
                found.some((folder) => folder.id === targetId);
              if (!sourceExists) missing(id, sync);
              if (!targetExists) missing(targetId, sync);
              setProblem(() => ({
                kind: !sourceExists || !targetExists ? 'missing' : 'change',
                message: !sourceExists
                  ? driveNotices.missing
                  : !targetExists
                    ? 'That destination is no longer in your drive. Choose another folder.'
                    : 'That move could not be completed. Your file stays here. Try again.',
              }));
            } catch {
              if (!scope.owns()) return;
              setProblem(() => ({
                kind: 'change',
                message:
                  'That move could not be checked. Your file stays here. Reload before trying again.',
              }));
            }
            return;
          }
          const staleId =
            path === 'folders/create' ? orNull(fields.parentFolderId) : id;
          if (statusOf(error) === 404 && staleId) missing(staleId, sync);
          setProblem(() => ({
            kind: statusOf(error) === 404 ? 'missing' : 'change',
            message:
              statusOf(error) === 409
                ? driveNotices.conflict
                : statusOf(error) === 404
                  ? driveNotices.missing
                  : 'That change did not save. Try again.',
          }));
        }),
    );
  };

  return {
    readSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** The owner's root, unless the page rendered its first page. */
    readRoot,
    /** The tab came back: the root and Recent may have moved meanwhile. */
    focused: () => {
      readRoot();
      readRecent();
    },
    /**
     * The frame's save settled, or Recent began or stopped being listed; a
     * seeded Recent skips the first.
     */
    saveSettled: (save: SaveState | undefined, listed: boolean) => {
      if (recentSeeded) {
        recentSeeded = false;
        return;
      }
      if (listed && (save === undefined || save === 'saved')) readRecent();
    },
    readRecent,
    loadFolders: () => {
      api.folders().then(
        (found) => publish({ folders: found, folderProblem: null }),
        () =>
          publish({
            folderProblem:
              'Folder destinations did not load. Close this menu and try again.',
          }),
      );
    },
    open: (id: string, title: string, origin?: 'link') => {
      const { sync } = ports.owner();
      if (sync && !sync.canOpen(id)) return;
      const current = findOpen(ports.opened(), id);
      if (!sync || current?.kind === 'loaded' || current?.kind === 'loading') {
        ports.dispatch({ type: 'tabs/open', id });
        ports.dispatch({ type: 'palette/close' });
        return;
      }
      // A tab with no editor until the body arrives, so nothing can be typed early.
      ports.dispatch({
        type: 'doc/opening',
        id,
        title,
        ...(origin ? { origin } : {}),
      });
      sync.open(id).then(
        (document) => {
          if (!sync.canOpen(id)) return;
          if (document) ports.dispatch({ type: 'doc/add', document });
          else {
            missing(id, sync);
            ports.dispatch({ type: 'doc/missing', id });
            setProblem(() => ({
              kind: 'missing',
              message: driveNotices.missing,
            }));
          }
        },
        () => ports.dispatch({ type: 'doc/failed', id }),
      );
    },
    createDocument,
    createFolder: (parentFolderId: string | null) =>
      change('folders/create', {
        parentFolderId: parentFolderId ?? '',
        name: 'New folder',
      }),
    saveRecovered: async (id: string): Promise<StoredDocument | null> => {
      const { sync, scope } = ports.owner();
      if (!sync) return null;
      let result: StoredDocument | null = null;
      await scope.run(async () => {
        const created = await mutate(scope, () => sync.saveAsNew(id));
        if (!scope.owns()) return;
        result = created;
        if (created) {
          ports.dispatch({
            type: 'drive/add',
            folderId: null,
            entry: { kind: 'document', id: created.id, title: created.title },
          });
          readRecent();
        }
      });
      return result;
    },
    folderCount: async (id: string) => {
      const { scope } = ports.owner();
      let count: number | undefined;
      await scope.run(async () => {
        const found = await api.folderCount(id);
        if (scope.owns()) count = found;
      });
      if (count === undefined)
        throw new Error('The document owner is no longer available');
      return count;
    },
    toggle: async (folderId: string, expanded: boolean, read: boolean) => {
      ports.dispatch({ type: 'drive/expand', folderId, expanded });
      if (expanded && !read) {
        try {
          await listFolder(folderId, null);
        } catch (error: unknown) {
          ports.dispatch({ type: 'drive/expand', folderId, expanded: false });
          readFailed(error, folderId, 'That folder did not open. Try again.');
          return false;
        }
      }
      return true;
    },
    more: (folderId: string | null, after: DriveCursor) => {
      listFolder(folderId, after).catch((error) =>
        readFailed(
          error,
          folderId,
          'More of your drive did not load. Try again.',
        ),
      );
    },
    change,
    dispose() {
      recentWait?.();
      recentWait = null;
      listeners.clear();
    },
  };
}
