'use client';

import type { Dispatch } from 'react';
import { loadedDocuments } from '../../features/documents/open-documents';
import { DocumentPane, type SaveState } from '../documents/document-pane';
import type { DocumentSync } from '../documents/document-sync';
import { ShowFiles } from './files-sidebar';
import { RecoveredDrafts } from '../documents/recovered-drafts';
import type { RoomAction, RoomState } from './room-state';

/** The open documents: tabs, saved state and the editor, or a way to start one. */
export function RoomDocument({
  state,
  dispatch,
  onEdit,
  onNew,
  onRetry,
  save,
  sync,
  saveRecovered,
}: {
  readonly sync?: DocumentSync;
  readonly saveRecovered: DocumentSync['saveAsNew'];
  readonly state: RoomState;
  readonly dispatch: Dispatch<RoomAction>;
  readonly onEdit: ((id: string, html: string) => void) | undefined;
  readonly onNew: () => void;
  readonly onRetry: ((id: string, title: string) => void) | undefined;
  readonly save: SaveState | null;
}) {
  return (
    <section
      aria-label="Document"
      className="flex min-h-0 flex-1 flex-col bg-surface-raised"
    >
      {sync ? (
        <RecoveredDrafts
          documents={loadedDocuments(state.opened)}
          sync={sync}
          saveRecovered={saveRecovered}
          dispatch={dispatch}
        />
      ) : null}
      <DocumentPane
        opened={state.opened}
        onRetry={onRetry}
        tabs={state.tabs}
        pages={state.pages}
        dispatch={dispatch}
        onEdit={onEdit}
        onNew={onNew}
        save={save}
        leading={<ShowFiles state={state} dispatch={dispatch} />}
        empty={
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <button
              type="button"
              onClick={onNew}
              className="h-room-target cursor-pointer rounded-sm bg-accent px-4 text-sm font-strong text-accent-ink hover:bg-accent-strong"
            >
              New document
            </button>
          </div>
        }
      />
    </section>
  );
}
