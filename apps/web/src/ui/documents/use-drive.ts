'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import { systemClock } from '@daisy/clock';
import type { ManagerAction } from '../../features/documents/document-manager-state';
import {
  findOpen,
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
import type { DocumentSync } from './document-sync';
import type { SaveState } from './document-pane';

type DriveProblem =
  | {
      readonly kind: 'read';
      readonly resourceId: string | null;
      readonly message: string;
    }
  | { readonly kind: 'change'; readonly message: string };
const statusOf = (error: unknown) =>
  (error as { readonly status?: unknown } | null)?.status;
import {
  driveApi,
  type DriveChange,
  type FolderRow,
  type RecentDocument,
} from './drive-api';
import { useRecentDocuments } from './use-recent-documents';

export type DriveActions = {
  readonly problem: string | null;
  readonly folderProblem: string | null;
  readonly folders: readonly FolderRow[];
  readonly loadFolders: () => void;
  readonly open: (id: string, title: string) => void;
  /** What was edited last, when the frame shows it. */
  readonly recent: readonly RecentDocument[];
  readonly createDocument: (folderId: string | null) => void;
  /** A folder named for now, its row ready for its real name. */
  readonly createFolder: (parentFolderId: string | null) => void;
  readonly toggle: (
    folderId: string,
    expanded: boolean,
    read: boolean,
  ) => Promise<boolean>;
  readonly saveRecovered: DocumentSync['saveAsNew'];
  readonly folderCount: (id: string) => Promise<number>;
  readonly more: (folderId: string | null, after: DriveCursor) => void;
  readonly change: (
    path: DriveChange,
    fields: Readonly<Record<string, string>>,
  ) => void;
};

const orNull = (value: string | undefined) => (value ? value : null);

/**
 * One manager's drive actions, wherever it opens. The tree changes only once
 * the authenticated document operation has agreed.
 */
export function useDrive({
  sync,
  opened,
  dispatch,
  initialFolders = [],
  listRoot = true,
  showRecent = false,
  save,
  initialRecent,
}: {
  readonly sync: DocumentSync | undefined;
  readonly opened: readonly OpenDocument[];
  readonly dispatch: Dispatch<ManagerAction>;
  readonly initialFolders?: readonly FolderRow[];
  /** False when the page already rendered the root's first page. */
  readonly listRoot?: boolean;
  /** True when the frame lists what was edited last. */
  readonly showRecent?: boolean;
  readonly save?: SaveState;
  readonly initialRecent?: readonly RecentDocument[];
}): DriveActions {
  const [folders, setFolders] = useState(initialFolders);
  const [problem, setProblem] = useState<DriveProblem | null>(null);
  const [folderProblem, setFolderProblem] = useState<string | null>(null);
  const { documents: recent, refresh: readRecent } = useRecentDocuments(
    showRecent,
    save,
    initialRecent,
  );
  const generation = useRef(0);
  const creating = useRef(false);
  const known = useRef(opened);
  useEffect(() => {
    known.current = opened;
  }, [opened]);

  const missing = useCallback(
    (id: string) => {
      generation.current++;
      dispatch({ type: 'drive/unlist', id });
      // A stale row may be an open document, or a folder with open descendants.
      // Recheck server truth without throwing away anyone's unsaved text.
      void sync
        ?.recheck(
          known.current.map((open) =>
            open.kind === 'loaded' ? open.document.id : open.id,
          ),
        )
        .catch(() => {});
    },
    [dispatch, sync],
  );
  const readFailed = useCallback(
    (error: unknown, resourceId: string | null, message: string) => {
      if (statusOf(error) === 404 && resourceId !== null) missing(resourceId);
      setProblem({
        kind: 'read',
        resourceId,
        message: statusOf(error) === 404 ? driveNotices.missing : message,
      });
    },
    [missing],
  );
  const mutate = async <T>(run: () => Promise<T>): Promise<T> => {
    generation.current++;
    const answer = await run();
    generation.current++;
    setProblem((current) => (current?.kind === 'change' ? null : current));
    return answer;
  };

  // Expansion and New here share the first read, so an older response cannot
  // arrive after the create and replace its newly inserted row.
  const firstPages = useRef(new Map<string | null, Promise<void>>());
  const listFolder = useCallback(
    (folderId: string | null, after: DriveCursor | null): Promise<void> => {
      const pending =
        after === null ? firstPages.current.get(folderId) : undefined;
      if (pending) return pending;
      const request = async (): Promise<void> => {
        const started = generation.current;
        const page = await driveApi.list(folderId, after);
        // A focus refresh may race a create, rename, move or deletion. Never
        // replace an acknowledged change with a page read before it committed.
        if (started !== generation.current) return request();
        setProblem((current) =>
          current?.kind === 'read' && current.resourceId === folderId
            ? null
            : current,
        );
        dispatch({
          type: 'drive/page',
          folderId,
          first: after === null,
          ...page,
        });
      };
      const read = request();
      if (after !== null) return read;
      const tracked = read.finally(() => firstPages.current.delete(folderId));
      firstPages.current.set(folderId, tracked);
      return tracked;
    },
    [dispatch],
  );

  useEffect(() => {
    if (!sync) return;
    if (listRoot)
      listFolder(null, null).catch((error) =>
        readFailed(error, null, 'Your drive did not load. Reload the page.'),
      );
    // Another tab may have changed the drive; a failed look changes nothing.
    const refresh = () => {
      void listFolder(null, null).catch((error) =>
        readFailed(error, null, 'Your drive did not load. Reload the page.'),
      );
      readRecent();
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [sync, listRoot, listFolder, readFailed, readRecent]);

  const open = (id: string, title: string) => {
    if (sync && !sync.canOpen(id)) return;
    const current = findOpen(known.current, id);
    if (!sync || current?.kind === 'loaded' || current?.kind === 'loading') {
      dispatch({ type: 'tabs/open', id });
      dispatch({ type: 'palette/close' });
      return;
    }
    // A tab with no editor until the body arrives, so nothing can be typed early.
    dispatch({ type: 'doc/opening', id, title });
    sync.open(id).then(
      (document) => {
        if (!sync.canOpen(id)) return;
        if (document) dispatch({ type: 'doc/add', document });
        else {
          missing(id);
          dispatch({ type: 'doc/failed', id });
          setProblem({
            kind: 'read',
            resourceId: id,
            message: driveNotices.missing,
          });
        }
      },
      () => dispatch({ type: 'doc/failed', id }),
    );
  };

  const createDocument = (folderId: string | null) => {
    if (!sync || !sync.available() || creating.current) return;
    creating.current = true;
    mutate(() => sync.create(folderId))
      .then((document) => {
        dispatch({ type: 'doc/add', document });
        const entry: DriveEntryView = {
          kind: 'document',
          id: document.id,
          title: document.title,
        };
        dispatch({
          type: 'drive/add',
          folderId,
          entry,
        });
      })
      .catch((error: unknown) => {
        if (statusOf(error) === 404 && folderId !== null) missing(folderId);
        setProblem({
          kind: 'change',
          message:
            statusOf(error) === 409
              ? DRIVE_FULL_NOTICE
              : statusOf(error) === 404
                ? driveNotices.missing
                : 'That document was not created. Try again.',
        });
      })
      .finally(() => {
        creating.current = false;
        readRecent();
      });
  };

  const change: DriveActions['change'] = (path, fields) => {
    if (path === 'create') return createDocument(orNull(fields.folderId));
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
    mutate(() =>
      driveApi.change<{
        folder?: DriveEntryView;
        deletedDocumentIds?: readonly string[];
      }>(path, body),
    )
      .then((answer) => {
        if (path === 'rename' || path === 'folders/rename')
          dispatch({
            type: 'drive/rename',
            id,
            label: (fields.title ?? fields.name ?? '').trim(),
            now: systemClock.now(),
          });
        else if (path === 'move')
          dispatch({
            type: 'drive/move',
            id,
            folderId: orNull(fields.folderId),
          });
        else if (path === 'folders/move')
          dispatch({
            type: 'drive/move',
            id,
            folderId: orNull(fields.parentFolderId),
          });
        else if (path === 'delete') {
          sync?.forget(id);
          dispatch({ type: 'drive/remove', id });
        } else if (path === 'folders/delete') {
          const documentIds = answer.deletedDocumentIds ?? [];
          sync?.forgetAll(documentIds);
          dispatch({ type: 'drive/folder-deleted', id, documentIds });
        } else if (path === 'folders/create' && answer.folder) {
          dispatch({
            type: 'drive/add',
            folderId: orNull(fields.parentFolderId),
            entry: answer.folder,
          });
          dispatch({ type: 'drive/renaming', id: answer.folder.id });
        }
        readRecent();
      })
      .catch((error: unknown) => {
        const staleId =
          path === 'folders/create' ? orNull(fields.parentFolderId) : id;
        if (statusOf(error) === 404 && staleId) missing(staleId);
        setProblem({
          kind: 'change',
          message:
            statusOf(error) === 409
              ? driveNotices.conflict
              : statusOf(error) === 404
                ? driveNotices.missing
                : 'That change did not save. Try again.',
        });
      });
  };

  return {
    problem: problem?.message ?? null,
    folderProblem,
    folders,
    recent,
    loadFolders: () => {
      driveApi.folders().then(
        (found) => {
          setFolders(found);
          setFolderProblem(null);
        },
        () =>
          setFolderProblem(
            'Folder destinations did not load. Close this menu and try again.',
          ),
      );
    },
    open,
    createDocument,
    createFolder: (parentFolderId) =>
      change('folders/create', {
        parentFolderId: parentFolderId ?? '',
        name: 'New folder',
      }),
    saveRecovered: async (id) => {
      if (!sync) return null;
      const created = await mutate(() => sync.saveAsNew(id));
      if (created) {
        dispatch({
          type: 'drive/add',
          folderId: null,
          entry: { kind: 'document', id: created.id, title: created.title },
        });
        readRecent();
      }
      return created;
    },
    folderCount: driveApi.folderCount,
    toggle: async (folderId, expanded, read) => {
      dispatch({ type: 'drive/expand', folderId, expanded });
      if (expanded && !read) {
        try {
          await listFolder(folderId, null);
        } catch (error: unknown) {
          dispatch({ type: 'drive/expand', folderId, expanded: false });
          readFailed(error, folderId, 'That folder did not open. Try again.');
          return false;
        }
      }
      return true;
    },
    more: (folderId, after) => {
      listFolder(folderId, after).catch((error) =>
        readFailed(
          error,
          folderId,
          'More of your drive did not load. Try again.',
        ),
      );
    },
    change,
  };
}
