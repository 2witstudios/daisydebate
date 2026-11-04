'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  initialManagerState,
  reduceManager,
} from '../../features/documents/document-manager-state';
import {
  emptyDrive,
  withPage,
  type DriveEntryView,
  type DriveCursor,
} from '../../features/documents/drive-tree';
import {
  loadedDocuments,
  openId as openDocumentId,
  openTitle,
} from '../../features/documents/open-documents';
import { cn } from '../cn';
import { Icon } from '../components/icon/icon';
import { CommandPalette, type PaletteChoice } from './command-palette';
import { DocumentPane } from './document-pane';
import type { DocumentSync } from './document-sync';
import { driveApi, type FolderRow } from './drive-api';
import { FileTree } from './file-tree';
import { RecoveredDrafts } from './recovered-drafts';
import { useDocumentSaving } from './use-document-saving';
import { useDocumentSync } from './use-document-sync';
import { useDrive } from './use-drive';
import { usePaletteShortcut } from './use-palette-shortcut';
import type { SaveState } from './document-pane';

/** What a page rendered on the server, so the tree is there before script runs. */
export type InitialDrive = {
  readonly folderId: string | null;
  readonly entries: readonly DriveEntryView[];
  readonly next: DriveCursor | null;
  readonly folders: readonly FolderRow[];
};

/**
 * The document manager (ADR 0111): the member's tree, search, tabs and editor as
 * one thing. It fills the frame a page gives it and draws none of its own (ADR
 * 0113); it imports nothing from any place it opens.
 */
export function DocumentManager({
  principalId,
  back,
  initial = null,
  title = 'Files',
  parentHref = null,
  notice: pageNotice = null,
  openId = null,
}: {
  readonly principalId: string;
  /** A document a link asked to open. */
  readonly openId?: string | null;
  readonly back: string;
  readonly initial?: InitialDrive | null;
  /** The sidebar's heading. */
  readonly title?: string;
  /** A way back, on a page that opened at a folder. */
  readonly parentHref?: string | null;
  readonly notice?: string | null;
}) {
  const saving = useDocumentSaving(principalId);
  return (
    <ManagerWorkspace
      key={principalId}
      {...saving}
      back={back}
      initial={initial}
      title={title}
      parentHref={parentHref}
      pageNotice={pageNotice}
      openId={openId}
    />
  );
}

/** A document manager over an owner its frame already holds, as a Round's end does. */
export function ManagerWorkspace({
  sync,
  notice,
  save,
  back,
  initial = null,
  title = 'Files',
  parentHref = null,
  pageNotice = null,
  openId = null,
}: {
  readonly openId?: string | null;
  readonly sync: DocumentSync;
  readonly notice: string | null;
  readonly save: SaveState;
  readonly back: string;
  readonly initial?: InitialDrive | null;
  readonly title?: string;
  readonly parentHref?: string | null;
  readonly pageNotice?: string | null;
}) {
  const [state, dispatch] = useReducer(
    reduceManager,
    initial
      ? withPage(emptyDrive, null, { ...initial, first: true })
      : emptyDrive,
    initialManagerState,
  );
  const { problem, setProblem } = useDocumentSync(
    sync,
    dispatch,
    state.tabs.open,
  );
  const report = useCallback(
    (message: string) => setProblem(message),
    [setProblem],
  );
  const drive = useDrive({
    sync,
    opened: state.opened,
    dispatch,
    setProblem: report,
    back,
    initialFolders: initial?.folders ?? [],
    rootFolderId: initial?.folderId ?? null,
    listRoot: initial === null,
    showRecent: true,
  });
  usePaletteShortcut(dispatch);
  const opened = useRef(false);
  useEffect(() => {
    if (openId === null || opened.current) return;
    opened.current = true;
    drive.open(openId, 'your document');
  });
  const choose = (choice: PaletteChoice) => {
    dispatch({ type: 'palette/close' });
    if (choice.kind === 'open') drive.open(choice.documentId, choice.title);
    else if (choice.kind === 'new-folder')
      drive.createFolder(initial?.folderId ?? null);
    else drive.createDocument(initial?.folderId ?? null);
  };

  const rootFolderId = initial?.folderId ?? null;
  return (
    <section aria-label="Your files" className="flex min-h-0 flex-1">
      <div
        className={cn(
          'flex w-drive shrink-0 flex-col border-r border-border bg-surface max-compact:w-full max-compact:border-r-0',
          state.pane === 'document' && 'max-compact:hidden',
        )}
      >
        <FileTree
          tree={state.drive}
          active={state.tabs.active}
          renaming={state.renaming}
          dispatch={dispatch}
          drive={drive}
          heading={{ title, parentHref }}
          rootFolderId={rootFolderId}
        />
      </div>
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col bg-surface-raised',
          state.pane === 'files' && 'max-compact:hidden',
        )}
      >
        {(problem ?? notice ?? pageNotice) ? (
          <p role="alert" className="border-b border-border px-4 py-2 text-sm">
            {problem ?? notice ?? pageNotice}
          </p>
        ) : null}
        <RecoveredDrafts
          documents={loadedDocuments(state.opened)}
          sync={sync}
          dispatch={dispatch}
          inFolderPage={rootFolderId !== null}
        />
        <DocumentPane
          opened={state.opened}
          onRetry={drive.open}
          tabs={state.tabs}
          pages={state.pages}
          dispatch={dispatch}
          onEdit={sync.change}
          onNew={() => drive.createDocument(rootFolderId)}
          save={save}
          leading={
            <button
              type="button"
              aria-label="Back to Files"
              className="flex h-full w-tab-strip shrink-0 cursor-pointer items-center justify-center border-r border-border compact:hidden"
              onClick={() => dispatch({ type: 'pane/files' })}
            >
              <Icon name="chevronLeft" size={16} />
            </button>
          }
          empty={
            <p className="px-10 pt-6 text-sm text-ink-muted max-compact:px-4">
              Open a file, or press + to start one.
            </p>
          }
        />
      </div>
      <CommandPalette
        open={state.palette !== 'closed'}
        mode={state.palette === 'create' ? 'create' : 'search'}
        documents={state.opened.map((open) => ({
          id: openDocumentId(open),
          title: openTitle(open),
        }))}
        search={driveApi.search}
        onChoose={choose}
        onClose={() => dispatch({ type: 'palette/close' })}
      />
    </section>
  );
}
