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
 * one thing. A page gives it the member and where a form returns to; it imports
 * nothing from any place it opens.
 */
export function DocumentManager({
  principalId,
  back,
  initial = null,
  title = 'Your files',
  notice: pageNotice = null,
  openId = null,
}: {
  readonly principalId: string;
  /** A document a link asked to open. */
  readonly openId?: string | null;
  readonly back: string;
  readonly initial?: InitialDrive | null;
  readonly title?: string;
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
  title,
  pageNotice = null,
  openId = null,
}: {
  readonly openId?: string | null;
  readonly sync: DocumentSync;
  readonly notice: string | null;
  readonly save: SaveState;
  readonly back: string;
  readonly initial?: InitialDrive | null;
  readonly title: string;
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
    documents: state.documents,
    dispatch,
    setProblem: report,
    back,
    initialFolders: initial?.folders ?? [],
    rootFolderId: initial?.folderId ?? null,
    listRoot: initial === null,
  });
  usePaletteShortcut(dispatch);
  const opened = useRef(false);
  useEffect(() => {
    if (openId === null || opened.current) return;
    opened.current = true;
    drive.open(openId);
  });
  const choose = (choice: PaletteChoice) => {
    if (choice.kind === 'open') drive.open(choice.documentId);
    else drive.createDocument(initial?.folderId ?? null);
  };

  return (
    <section
      aria-label="Your files"
      className="mx-auto flex w-full max-w-dash-column flex-col gap-3 px-6 pb-8"
    >
      <h2 className="text-lg font-bold">{title}</h2>
      <noscript>
        <p>
          You can organize your documents here without JavaScript. Editing one
          needs it.
        </p>
      </noscript>
      {(problem ?? notice ?? pageNotice) ? (
        <p role="alert">{problem ?? notice ?? pageNotice}</p>
      ) : null}
      <div className="flex room-workspace border-t border-border max-narrow:flex-col">
        <div className="flex w-drive shrink-0 flex-col gap-3 border-r border-border bg-surface p-3 max-narrow:w-full max-narrow:border-r-0">
          <form method="post" action="/api/documents/create">
            <input type="hidden" name="back" value={back} />
            <input
              type="hidden"
              name="folderId"
              value={initial?.folderId ?? ''}
            />
            <button
              type="submit"
              onClick={(event) => {
                event.preventDefault();
                drive.createDocument(initial?.folderId ?? null);
              }}
              className="h-room-target w-full cursor-pointer rounded-sm bg-accent px-4 text-sm font-strong text-accent-ink hover:bg-accent-strong"
            >
              New document
            </button>
          </form>
          <FileTree
            tree={state.drive}
            active={state.tabs.active}
            dispatch={dispatch}
            drive={drive}
            rootFolderId={initial?.folderId ?? null}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col bg-surface-raised">
          <RecoveredDrafts
            documents={state.documents}
            sync={sync}
            dispatch={dispatch}
            inFolderPage={(initial?.folderId ?? null) !== null}
          />
          <DocumentPane
            documents={state.documents}
            tabs={state.tabs}
            pages={state.pages}
            dispatch={dispatch}
            onEdit={sync.change}
            save={save}
            empty={<p className="p-4 text-ink-muted">No files yet.</p>}
          />
        </div>
      </div>
      <CommandPalette
        open={state.paletteOpen}
        documents={state.documents}
        search={driveApi.search}
        onChoose={choose}
        onClose={() => dispatch({ type: 'palette/close' })}
      />
    </section>
  );
}
