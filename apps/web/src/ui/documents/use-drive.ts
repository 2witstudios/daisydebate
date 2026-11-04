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
}: {
  readonly sync: DocumentSync | undefined;
  readonly opened: readonly OpenDocument[];
  readonly dispatch: Dispatch<ManagerAction>;
  readonly initialFolders?: readonly FolderRow[];
  /** False when the page already rendered the root's first page. */
  readonly listRoot?: boolean;
  /** True when the frame lists what was edited last. */
  readonly showRecent?: boolean;
  readonly save?: 'saved' | 'saving' | 'unsaved';
}): DriveActions {
  const [folders, setFolders] = useState(initialFolders);
  const [problem, setProblem] = useState<string | null>(null);
  const [folderProblem, setFolderProblem] = useState<string | null>(null);
  const { documents: recent, refresh: readRecent } = useRecentDocuments(
    showRecent,
    save,
  );
  const generation = useRef(0);
  const creating = useRef(false);
  const known = useRef(opened);
  useEffect(() => {
    known.current = opened;
  }, [opened]);

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
      listFolder(null, null).catch(() =>
        setProblem('Your drive did not load. Reload the page.'),
      );
    // Another tab may have changed the drive; a failed look changes nothing.
    const refresh = () => {
      void listFolder(null, null).catch(() => {});
      readRecent();
    };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [sync, listRoot, listFolder, setProblem, readRecent]);

  const open = (id: string, title: string) => {
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
        if (document) dispatch({ type: 'doc/add', document });
        else {
          dispatch({ type: 'drive/remove', id });
          setProblem('That document is no longer in your drive.');
        }
      },
      () => dispatch({ type: 'doc/failed', id }),
    );
  };

  const createDocument = (folderId: string | null) => {
    if (!sync || creating.current) return;
    creating.current = true;
    generation.current++;
    sync
      .create(folderId)
      .then((document) => {
        generation.current++;
        setProblem(null);
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
      .catch((error: unknown) =>
        setProblem(
          (error as { readonly status?: unknown }).status === 409
            ? DRIVE_FULL_NOTICE
            : 'That document was not created. Try again.',
        ),
      )
      .finally(() => {
        creating.current = false;
        readRecent();
      });
  };

  const change: DriveActions['change'] = (path, fields) => {
    if (path === 'create') return createDocument(orNull(fields.folderId));
    generation.current++;
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
    driveApi
      .change<{
        folder?: DriveEntryView;
        deletedDocumentIds?: readonly string[];
      }>(path, body)
      .then((answer) => {
        generation.current++;
        setProblem(null);
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
          dispatch({ type: 'drive/remove', id });
          for (const removed of answer.deletedDocumentIds ?? []) {
            sync?.forget(removed);
            dispatch({ type: 'drive/remove', id: removed });
          }
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
      .catch((error: unknown) =>
        setProblem(
          (error as { readonly status?: number }).status === 409
            ? driveNotices.conflict
            : 'That change did not save. Try again.',
        ),
      );
  };

  return {
    problem,
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
    folderCount: driveApi.folderCount,
    toggle: async (folderId, expanded, read) => {
      dispatch({ type: 'drive/expand', folderId, expanded });
      if (expanded && !read) {
        try {
          await listFolder(folderId, null);
        } catch {
          setProblem('That folder did not open. Try again.');
          return false;
        }
      }
      return true;
    },
    more: (folderId, after) => {
      listFolder(folderId, after).catch(() =>
        setProblem('More of your drive did not load. Try again.'),
      );
    },
    change,
  };
}
