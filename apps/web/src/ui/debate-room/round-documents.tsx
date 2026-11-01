'use client';

import { useReducer } from 'react';
import { systemClock } from '@daisy/clock';
import { buildTree } from '../../features/debate-room/workspace';
import { CommandPalette, type PaletteChoice } from './command-palette';
import { DocumentPane } from './document-pane';
import { DrawerFiles } from './drawer-files';
import {
  initialPersistedWorkspace,
  reducePersistedWorkspace,
} from './persisted-workspace';
import { usePaletteShortcut } from './use-palette-shortcut';
import { useDocumentSync } from './use-document-sync';
import { useRoundSync } from './use-round-sync';
import type { RecoveredDraft } from './document-sync';

/** Private files backed by the persisted Round's participant-scoped document API. */
export function RoundDocuments({
  roundId,
  principalId,
}: {
  readonly roundId: string;
  readonly principalId: string;
}) {
  const [state, dispatch] = useReducer(
    reducePersistedWorkspace,
    initialPersistedWorkspace,
  );
  const { sync, notice, save } = useRoundSync(roundId, principalId);
  const { problem, setProblem } = useDocumentSync(sync, dispatch);
  usePaletteShortcut(dispatch);
  const choose = async (choice: PaletteChoice) => {
    if (choice.kind === 'open') {
      dispatch({ type: 'tabs/open', id: choice.documentId });
      dispatch({ type: 'palette/close' });
      return;
    }
    if (choice.folder === 'club') return;
    try {
      dispatch({
        type: 'doc/add',
        document: await sync.create(choice.folder, choice.templateId),
      });
    } catch {
      setProblem('That file was not created. Try again.');
    }
  };
  const recovered: [string, RecoveredDraft][] = [...state.recovered];

  return (
    <section
      aria-label="Your Round files"
      className="mx-auto flex w-full max-w-dash-column flex-col gap-3 px-6 pb-8"
    >
      <h2 className="text-lg font-bold">Your files</h2>
      {(problem ?? notice) ? <p role="alert">{problem ?? notice}</p> : null}
      <div className="flex room-workspace border-t border-border max-narrow:flex-col">
        <div className="flex w-round-drawer shrink-0 flex-col border-r border-border bg-surface p-3 max-narrow:w-full max-narrow:border-r-0">
          <DrawerFiles
            tree={buildTree(state.documents, null)}
            active={state.tabs.active}
            dispatch={dispatch}
            transcript={null}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col bg-surface-raised">
          {recovered.length > 0 ? (
            <div className="border-b border-border p-3">
              <p className="text-sm font-semibold text-live">
                An unsaved draft was recovered.
              </p>
              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="button"
                  className="cursor-pointer px-3 py-1 text-sm text-ink"
                  onClick={() =>
                    dispatch({
                      type: 'doc/recovered/restore',
                      id: recovered[0][0],
                      now: systemClock.now(),
                    })
                  }
                >
                  Restore draft
                </button>
                <button
                  type="button"
                  className="cursor-pointer px-3 py-1 text-sm text-ink-muted"
                  onClick={() =>
                    dispatch({
                      type: 'doc/recovered/discard',
                      id: recovered[0][0],
                    })
                  }
                >
                  Discard draft
                </button>
              </div>
            </div>
          ) : null}
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
