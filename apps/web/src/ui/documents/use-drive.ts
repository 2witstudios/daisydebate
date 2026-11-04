'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import { systemClock } from '@daisy/clock';
import type { ManagerAction } from '../../features/documents/document-manager-state';
import {
  findOpen,
  type OpenDocument,
} from '../../features/documents/open-documents';
import { DRIVE_FULL_NOTICE } from '../../features/documents/drive-return';
import type {
  DriveCursor,
  DriveEntryView,
} from '../../features/documents/drive-tree';
import type { DocumentSync } from './document-sync';
import { driveApi, type DriveChange, type FolderRow } from './drive-api';

export type DriveActions = {
  /** The page a plain form returns to, without script. */
  readonly back: string;
  readonly folders: readonly FolderRow[];
  readonly loadFolders: () => void;
  readonly open: (id: string, title: string) => void;
  readonly createDocument: (folderId: string | null) => void;
  /** A folder named for now, its row ready for its real name. */
  readonly createFolder: (parentFolderId: string | null) => void;
  readonly toggle: (folderId: string, expanded: boolean, read: boolean) => void;
  readonly more: (folderId: string | null, after: DriveCursor) => void;
  readonly change: (
    path: DriveChange,
    fields: Readonly<Record<string, string>>,
  ) => void;
};

const orNull = (value: string | undefined) => (value ? value : null);

/**
 * One manager's drive actions, wherever it opens. Each change goes to the route
 * a plain form posts to, and the tree changes only once the server has agreed.
 */
export function useDrive({
  sync,
  opened,
  dispatch,
  setProblem,
  back,
  initialFolders = [],
  rootFolderId = null,
  listRoot = true,
}: {
  readonly sync: DocumentSync | undefined;
  readonly opened: readonly OpenDocument[];
  readonly dispatch: Dispatch<ManagerAction>;
  readonly setProblem: (message: string) => void;
  readonly back: string;
  readonly initialFolders?: readonly FolderRow[];
  readonly rootFolderId?: string | null;
  /** False when the page already rendered the root's first page. */
  readonly listRoot?: boolean;
}): DriveActions {
  const [folders, setFolders] = useState(initialFolders);
  const creating = useRef(false);
  const known = useRef(opened);
  useEffect(() => {
    known.current = opened;
  }, [opened]);

  const listFolder = useCallback(
    async (folderId: string | null, after: DriveCursor | null) => {
      const page = await driveApi.list(folderId, after);
      dispatch({
        type: 'drive/page',
        folderId: folderId === rootFolderId ? null : folderId,
        first: after === null,
        ...page,
      });
    },
    [dispatch, rootFolderId],
  );

  useEffect(() => {
    if (!sync) return;
    if (listRoot)
      listFolder(rootFolderId, null).catch(() =>
        setProblem('Your drive did not load. Reload the page.'),
      );
    // Another tab may have changed the drive; a failed look changes nothing.
    const refresh = () => void listFolder(rootFolderId, null).catch(() => {});
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [sync, listRoot, listFolder, rootFolderId, setProblem]);

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
    sync
      .create(folderId)
      .then((document) => {
        dispatch({ type: 'doc/add', document });
        const entry: DriveEntryView = {
          kind: 'document',
          id: document.id,
          title: document.title,
        };
        dispatch({
          type: 'drive/add',
          folderId: folderId === rootFolderId ? null : folderId,
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
      });
  };

  const treeFolder = (id: string | null) => (id === rootFolderId ? null : id);
  /** A move leaves this page's tree when it goes above the folder the page opened at. */
  const moved = (id: string, target: string | null) =>
    target === null && rootFolderId !== null
      ? dispatch({ type: 'drive/remove', id })
      : dispatch({ type: 'drive/move', id, folderId: treeFolder(target) });

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
    driveApi
      .change<{ folder?: DriveEntryView }>(path, body)
      .then((answer) => {
        if (path === 'rename' || path === 'folders/rename')
          dispatch({
            type: 'drive/rename',
            id,
            label: (fields.title ?? fields.name ?? '').trim(),
            now: systemClock.now(),
          });
        else if (path === 'move') moved(id, orNull(fields.folderId));
        else if (path === 'folders/move')
          moved(id, orNull(fields.parentFolderId));
        else if (path === 'delete') {
          sync?.forget(id);
          dispatch({ type: 'drive/remove', id });
        } else if (path === 'folders/create' && answer.folder) {
          dispatch({
            type: 'drive/add',
            folderId: treeFolder(orNull(fields.parentFolderId)),
            entry: answer.folder,
          });
          dispatch({ type: 'drive/renaming', id: answer.folder.id });
        }
        setFolders([]);
      })
      .catch(() => setProblem('That change did not save. Try again.'));
  };

  return {
    back,
    folders,
    loadFolders: () => {
      driveApi.folders().then(setFolders, () => {});
    },
    open,
    createDocument,
    createFolder: (parentFolderId) =>
      change('folders/create', {
        parentFolderId: parentFolderId ?? '',
        name: 'New folder',
      }),
    toggle: (folderId, expanded, read) => {
      dispatch({ type: 'drive/expand', folderId, expanded });
      if (expanded && !read)
        listFolder(folderId, null).catch(() =>
          setProblem('That folder did not open. Try again.'),
        );
    },
    more: (folderId, after) => {
      listFolder(folderId, after).catch(() =>
        setProblem('More of your drive did not load. Try again.'),
      );
    },
    change,
  };
}
