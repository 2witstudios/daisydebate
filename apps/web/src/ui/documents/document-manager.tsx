'use client';

import { useReducer } from 'react';
import { CommandPalette, type PaletteChoice } from './command-palette';
import { DocumentPane } from './document-pane';
import { FileTree } from './file-tree';
import {
  initialPersistedWorkspace,
  reducePersistedWorkspace,
} from './persisted-workspace';
import { usePaletteShortcut } from './use-palette-shortcut';
import { useDocumentSync } from './use-document-sync';
import { useDocumentSaving } from './use-document-saving';
import { RecoveredDrafts } from './recovered-drafts';

/** Private files backed by the persisted Round's participant-scoped document API. */
export function DocumentManager({
  roundId,
  principalId,
}: {
  readonly roundId: string;
  readonly principalId: string;
}) {
  const saving = useDocumentSaving(roundId, principalId);
  return <ManagerWorkspace key={`${roundId}:${principalId}`} {...saving} />;
}

/** Document UI state follows its owner identity; the sync lifetime remains outside the key. */
function ManagerWorkspace({
  sync,
  notice,
  save,
}: ReturnType<typeof useDocumentSaving>) {
  const [state, dispatch] = useReducer(
    reducePersistedWorkspace,
    initialPersistedWorkspace,
  );
  const { problem, setProblem } = useDocumentSync(sync, dispatch);
  usePaletteShortcut(dispatch);
  const choose = async (choice: PaletteChoice) => {
    if (choice.kind === 'open') {
      dispatch({ type: 'tabs/open', id: choice.documentId });
      dispatch({ type: 'palette/close' });
      return;
    }
    try {
      dispatch({
        type: 'doc/add',
        document: await sync.create(),
      });
    } catch {
      setProblem('That file was not created. Try again.');
    }
  };

  return (
    <section
      aria-label="Your files"
      className="mx-auto flex w-full max-w-dash-column flex-col gap-3 px-6 pb-8"
    >
      <h2 className="text-lg font-bold">Your files</h2>
      {(problem ?? notice) ? <p role="alert">{problem ?? notice}</p> : null}
      <div className="flex room-workspace border-t border-border max-narrow:flex-col">
        <div className="flex w-round-files shrink-0 flex-col border-r border-border bg-surface p-3 max-narrow:w-full max-narrow:border-r-0">
          <FileTree
            documents={state.documents}
            active={state.tabs.active}
            dispatch={dispatch}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col bg-surface-raised">
          <RecoveredDrafts
            documents={state.documents}
            sync={sync}
            dispatch={dispatch}
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
        onChoose={(choice) => void choose(choice)}
        onClose={() => dispatch({ type: 'palette/close' })}
      />
    </section>
  );
}
