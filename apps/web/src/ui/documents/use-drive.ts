'use client';

import { useActivation } from '../edge/use-activation';
import { useDeliver } from '../edge/use-answer';
import { useWindowEvent } from '../edge/use-dom-events';
import { useDriver } from '../edge/use-driver';
import { useLatest } from '../edge/use-latest';
import { browserScheduler } from '../edge/browser-time';
import { useCallback, useMemo, type Dispatch } from 'react';
import { nowMs, systemClock } from '@daisy/clock';
import type { ManagerAction } from '../../features/documents/document-manager-state';
import type { OpenDocument } from '../../features/documents/open-documents';
import type { DriveCursor } from '../../features/documents/drive-tree';
import type { DocumentSync } from './document-sync';
import type { SaveState } from './document-pane';
import {
  driveApi,
  type DriveChange,
  type FolderRow,
  type RecentDocument,
} from './drive-api';
import { createDriveOperations } from './drive-operations';
import {
  createDriveDriver,
  seedDrive,
  type DriveSnapshot,
} from './drive-driver';

export type DriveActions = {
  /**
   * Whether the drive has started. It starts after the first commit, and an
   * action before then does nothing, so a mount-time request waits for this.
   */
  readonly ready: boolean;
  readonly problem: string | null;
  readonly folderProblem: string | null;
  readonly folders: readonly FolderRow[];
  readonly loadFolders: () => void;
  readonly open: (id: string, title: string, origin?: 'link') => void;
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

/**
 * One manager's drive actions, wherever it opens (`createDriveDriver`). The
 * owner's operation sequence is activated as the render that built it
 * commits; the driver runs every read and change in it.
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
  const scope = useMemo(() => createDriveOperations(sync), [sync]);
  useActivation(scope);
  const owner = useLatest(useMemo(() => ({ sync, scope }), [sync, scope]));
  const known = useLatest(opened);
  const send = useLatest(dispatch);
  const listsRecent = useLatest(showRecent);
  const recentSeeded = initialRecent !== undefined;
  const start = useCallback(
    (seed: DriveSnapshot) =>
      createDriveDriver({
        seed,
        recentSeeded,
        api: driveApi,
        owner,
        opened: known,
        dispatch: (action) => send()(action),
        showRecent: listsRecent,
        now: () => systemClock.now(),
        clockMs: () => nowMs(systemClock),
        after: browserScheduler.after,
      }),
    [recentSeeded, owner, known, send, listsRecent],
  );
  const [shown, drive] = useDriver(
    () => seedDrive(initialFolders, initialRecent),
    start,
  );
  // Each owner reads the root once, unless the page rendered its first page.
  const rooted = useMemo(
    () => ({ drive, sync, listRoot }),
    [drive, sync, listRoot],
  );
  useDeliver(rooted, (next) => {
    if (next.sync && next.listRoot) next.drive?.readRoot();
  });
  // The frame's save settling refreshes Recent, as does listing it at all.
  const settled = useMemo(
    () => ({ drive, save, showRecent }),
    [drive, save, showRecent],
  );
  useDeliver(settled, (next) =>
    next.drive?.saveSettled(next.save, next.showRecent),
  );
  useWindowEvent('focus', () => drive?.focused(), sync !== undefined);
  return {
    ready: drive !== null,
    problem: shown.problem?.message ?? null,
    folderProblem: shown.folderProblem,
    folders: shown.folders,
    recent: shown.recent,
    loadFolders: () => drive?.loadFolders(),
    open: (id, title, origin) => drive?.open(id, title, origin),
    createDocument: (folderId) => drive?.createDocument(folderId),
    createFolder: (parentFolderId) => drive?.createFolder(parentFolderId),
    toggle: (folderId, expanded, read) =>
      drive?.toggle(folderId, expanded, read) ?? Promise.resolve(false),
    saveRecovered: (id) => drive?.saveRecovered(id) ?? Promise.resolve(null),
    folderCount: (id) =>
      drive?.folderCount(id) ??
      Promise.reject(new Error('The document owner is no longer available')),
    more: (folderId: string | null, after: DriveCursor) =>
      drive?.more(folderId, after),
    change: (path: DriveChange, fields) => drive?.change(path, fields),
  };
}
