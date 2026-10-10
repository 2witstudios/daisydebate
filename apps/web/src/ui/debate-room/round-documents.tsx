'use client';

import { useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { buildTree } from '../../features/debate-room/workspace';
import { CommandPalette, type PaletteChoice } from './command-palette';
import { createDocumentsApi } from './documents-api';
import { createDocumentSync } from './document-sync';
import { DocumentPane } from './document-pane';
import { FileTree } from './file-tree';
import { PaneDivider } from './pane-divider';
import {
  initialPersistedWorkspace,
  reducePersistedWorkspace,
} from './persisted-workspace';
import { usePaletteShortcut } from './use-palette-shortcut';
import { useDocumentSync } from './use-document-sync';

/** Private files backed by the persisted Round's participant-scoped document API. */
export function RoundDocuments({ roundId }: { readonly roundId: string }) {
  const [state, dispatch] = useReducer(
    reducePersistedWorkspace,
    initialPersistedWorkspace,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const sync = useMemo(
    () =>
      createDocumentSync({
        roundId,
        api: createDocumentsApi(),
        onConflict: () =>
          setNotice(
            'This file changed in another tab. Reload before editing it again.',
          ),
        onSaveFailed: () =>
          setNotice('Your changes are not saved yet. Retrying.'),
        onSaveRefused: () =>
          setNotice('These changes were not saved. Reload and try again.'),
        onSaved: () => setNotice(null),
      }),
    [roundId],
  );
  const { problem, setProblem } = useDocumentSync(sync, dispatch);
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    root.current?.style.setProperty('--room-tree', `${state.treeWidth}px`);
  }, [state.treeWidth]);
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
  return (
    <section aria-label="Your Round files" className="flex flex-col gap-2">
      <h2 className="font-strong">Your files</h2>
      {(problem ?? notice) ? <p role="alert">{problem ?? notice}</p> : null}
      <div ref={root} className="flex room-workspace border-t border-border">
        <div className="flex min-w-0 room-tree-pane">
          <FileTree
            tree={buildTree(state.documents, null)}
            active={state.tabs.active}
            dispatch={dispatch}
            transcriptAvailable={false}
          />
        </div>
        <PaneDivider
          pane="tree"
          label="Resize files"
          value={state.treeWidth}
          onResize={(startPx, deltaPx) =>
            dispatch({ type: 'layout/resize', pane: 'tree', startPx, deltaPx })
          }
          onNudge={(key) =>
            dispatch({ type: 'layout/nudge', pane: 'tree', key })
          }
        />
        <div className="flex min-w-0 flex-1 flex-col bg-surface-raised">
          <DocumentPane
            documents={state.documents}
            tabs={state.tabs}
            pages={state.pages}
            dispatch={dispatch}
            onEdit={sync.change}
            empty={
              <p className="p-4 text-ink-muted">
                Choose New document to create your first file.
              </p>
            }
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
