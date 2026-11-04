'use client';

import { useEffect, useLayoutEffect, useReducer, useRef } from 'react';
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
  initial = null,
  notice: pageNotice = null,
  openId = null,
}: {
  readonly principalId: string;
  /** A document a link asked to open. */
  readonly openId?: string | null;
  readonly initial?: InitialDrive | null;
  readonly notice?: string | null;
}) {
  const saving = useDocumentSaving(principalId);
  return (
    <ManagerWorkspace
      key={principalId}
      {...saving}
      initial={initial}
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
  initial = null,
  pageNotice = null,
  openId = null,
}: {
  readonly openId?: string | null;
  readonly sync: DocumentSync;
  readonly notice: string | null;
  readonly save: SaveState;
  readonly initial?: InitialDrive | null;
  readonly pageNotice?: string | null;
}) {
  const [state, dispatch] = useReducer(
    reduceManager,
    initial
      ? withPage(emptyDrive, null, { ...initial, first: true })
      : emptyDrive,
    initialManagerState,
  );
  const { problem } = useDocumentSync(sync, dispatch, state.tabs.open);
  const drive = useDrive({
    sync,
    opened: state.opened,
    dispatch,
    initialFolders: initial?.folders ?? [],
    listRoot: initial === null,
    showRecent: true,
    save,
  });
  usePaletteShortcut(dispatch);
  const filesPane = useRef<HTMLDivElement>(null);
  const backToFiles = useRef<HTMLButtonElement>(null);
  const previousPane = useRef(state.pane);
  useLayoutEffect(() => {
    if (previousPane.current === state.pane) return;
    previousPane.current = state.pane;
    if (!window.matchMedia('(width < 901px)').matches) return;
    const target =
      state.pane === 'files'
        ? filesPane.current?.querySelector<HTMLButtonElement>('button')
        : backToFiles.current;
    target?.focus();
  }, [state.pane]);
  const opened = useRef(false);
  useEffect(() => {
    if (openId === null || opened.current) return;
    opened.current = true;
    drive.open(openId, 'your document');
  });
  const choose = (choice: PaletteChoice) => {
    dispatch({ type: 'palette/close' });
    if (choice.kind === 'open') drive.open(choice.documentId, choice.title);
    else if (choice.kind === 'new-folder') drive.createFolder(null);
    else drive.createDocument(null);
  };

  return (
    <section aria-label="Your files" className="flex min-h-0 flex-1 flex-col">
      {[...new Set([notice, problem, drive.problem, pageNotice])]
        .filter(Boolean)
        .map((message) => (
          <p
            key={message}
            role="alert"
            className="border-b border-border px-4 py-2 text-sm"
          >
            {message}
          </p>
        ))}
      <RecoveredDrafts
        documents={loadedDocuments(state.opened)}
        sync={sync}
        dispatch={dispatch}
      />
      <div className="flex min-h-0 flex-1">
        <div
          ref={filesPane}
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
            heading={{ title: 'Files' }}
          />
        </div>
        <div
          className={cn(
            'flex min-w-0 flex-1 flex-col bg-surface-raised',
            state.pane === 'files' && 'max-compact:hidden',
          )}
        >
          <DocumentPane
            opened={state.opened}
            onRetry={drive.open}
            tabs={state.tabs}
            pages={state.pages}
            dispatch={dispatch}
            onEdit={sync.change}
            onNew={() => drive.createDocument(null)}
            save={save}
            leading={
              <button
                type="button"
                ref={backToFiles}
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
      </div>
      <CommandPalette
        mode={state.palette}
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
