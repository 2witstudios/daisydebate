'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from 'react';
import { systemClock, systemId } from '@daisy/clock';
import {
  videoHeightFor,
  workspaceMinHeight,
  type Pane,
} from '../../features/debate-room/layout';
import { groupTranscript } from '../../features/debate-room/transcript';
import { buildTree } from '../../features/debate-room/workspace';
import { CommandPalette, type PaletteChoice } from './command-palette';
import { LayoutGroup, RoundControls } from './controls';
import type { DocumentSync } from './document-sync';
import { DocumentEditor } from './editor/document-editor';
import { DocumentTabs, FileTree, TRANSCRIPT_ID } from './file-tree';
import { PaneDivider } from './pane-divider';
import {
  initialRoomState,
  pageToneOf,
  reduceRoom,
  type RoomAction,
  type RoomState,
} from './room-state';
import type { RoundSnapshot } from './round';
import { RoomSidebar } from './sidebar';
import { RoundHeader, VideoStage } from './stage';
import { TranscriptView } from './transcript-view';
import { useDocumentSync } from './use-document-sync';

/** Writes the pane sizes as custom properties (CSSOM, so the CSP allows it). */
function usePaneVariables(round: RoundSnapshot, state: RoomState) {
  const root = useRef<HTMLDivElement>(null);
  const video = videoHeightFor(state.layout, round.phase);
  useLayoutEffect(() => {
    const style = root.current?.style;
    if (!style) return;
    style.setProperty('--room-tree', `${state.layout.treeWidth}px`);
    style.setProperty('--room-sidebar', `${state.layout.sidebarWidth}px`);
    style.setProperty('--room-video', `${video}px`);
    style.setProperty('--room-workspace', `${workspaceMinHeight(video)}px`);
  }, [state.layout.treeWidth, state.layout.sidebarWidth, video]);
  return { root, video };
}

/** ⌘K or Ctrl+K opens the palette from anywhere in the room. */
function usePaletteShortcut(dispatch: Dispatch<RoomAction>) {
  useEffect(() => {
    const open = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey))
        return;
      event.preventDefault();
      dispatch({ type: 'palette/open' });
    };
    document.addEventListener('keydown', open);
    return () => document.removeEventListener('keydown', open);
  }, [dispatch]);
}

/** The sidebar exists when the round has channels or agents to show. */
const hasSidebar = (round: RoundSnapshot) =>
  round.channels.length > 0 || round.agents.length > 0;

function Workspace({
  round,
  state,
  dispatch,
  onEdit,
}: {
  readonly round: RoundSnapshot;
  readonly state: RoomState;
  readonly dispatch: Dispatch<RoomAction>;
  readonly onEdit?: ((id: string, html: string) => void) | undefined;
}) {
  const tree = useMemo(
    () => buildTree(state.documents, round.clubName),
    [state.documents, round.clubName],
  );
  const sections = useMemo(
    () =>
      groupTranscript(round.transcript, round.speeches, (slot) =>
        slot.side === round.self.side ? 'You' : round.opponent.name,
      ),
    [round],
  );
  const active = state.tabs.active;
  const doc = state.documents.find((d) => d.id === active);
  const resize = (pane: Pane) => (startPx: number, deltaPx: number) =>
    dispatch({ type: 'layout/resize', pane, startPx, deltaPx });
  const nudge = (pane: Pane) => (key: string) =>
    dispatch({ type: 'layout/nudge', pane, key });
  const titleOf = (id: string) =>
    id === TRANSCRIPT_ID
      ? 'Transcript'
      : (state.documents.find((d) => d.id === id)?.title ?? '');
  const live =
    round.phase === 'opponent-speaking'
      ? (round.speeches[round.liveIndex]?.id ?? null)
      : null;

  return (
    <div className="flex room-workspace flex-1 border-t border-border">
      {state.layout.treeOpen ? (
        <>
          <div className="flex min-w-0 room-tree-pane">
            <FileTree tree={tree} active={active} dispatch={dispatch} />
          </div>
          <PaneDivider
            pane="tree"
            label="Resize files"
            value={state.layout.treeWidth}
            onResize={resize('tree')}
            onNudge={nudge('tree')}
          />
        </>
      ) : null}
      <section
        aria-label="Document"
        className="flex min-w-0 flex-1 flex-col bg-surface-raised"
      >
        <DocumentTabs
          tabs={state.tabs.open.map((id) => ({ id, title: titleOf(id) }))}
          active={active}
          dispatch={dispatch}
        />
        {active === TRANSCRIPT_ID ? (
          <TranscriptView
            sections={sections}
            liveSpeechId={live}
            filter={state.transcriptFilter}
            dispatch={dispatch}
          />
        ) : null}
        {doc ? (
          <DocumentEditor
            key={doc.id}
            document={doc}
            access={doc.folder === 'club' ? 'Club' : 'Only you'}
            page={pageToneOf(state, doc.id)}
            onPage={(tone) =>
              dispatch({ type: 'page/tone', documentId: doc.id, tone })
            }
            onChange={(html) => {
              dispatch({
                type: 'doc/update',
                id: doc.id,
                html,
                now: systemClock.now(),
              });
              onEdit?.(doc.id, html);
            }}
          />
        ) : null}
      </section>
      {state.layout.sidebarOpen && hasSidebar(round) ? (
        <>
          <PaneDivider
            pane="sidebar"
            label="Resize sidebar"
            value={state.layout.sidebarWidth}
            onResize={resize('sidebar')}
            onNudge={nudge('sidebar')}
          />
          <div className="flex min-w-0 room-sidebar-pane">
            <RoomSidebar round={round} state={state} dispatch={dispatch} />
          </div>
        </>
      ) : null}
    </div>
  );
}

/** A round with its own stage and controls (a bot round's voice and clock). */
export type RoomParts = {
  readonly stage: ReactNode;
  readonly controls: (layout: ReactNode) => ReactNode;
  readonly below?: ReactNode;
};

/** The debater's round: videos, controls with the clock, then the workspace. */
export function DebateRoom({
  round,
  parts,
  sync,
  notice = null,
}: {
  readonly round: RoundSnapshot;
  readonly parts?: RoomParts;
  /** Server-backed documents; without it the room keeps them in memory. */
  readonly sync?: DocumentSync;
  /** A standing problem the round's owner reports (saves failing). */
  readonly notice?: string | null;
}) {
  const reducer = useMemo(() => reduceRoom(round), [round]);
  const [state, dispatch] = useReducer(reducer, round, initialRoomState);
  const { root, video } = usePaneVariables(round, state);
  usePaletteShortcut(dispatch);
  const { problem, setProblem } = useDocumentSync(sync, dispatch);

  const choose = (choice: PaletteChoice) => {
    if (choice.kind === 'open')
      return dispatch({ type: 'tabs/open', id: choice.documentId });
    if (!sync)
      return dispatch({
        type: 'doc/create',
        id: systemId.next(),
        now: systemClock.now(),
        templateId: choice.templateId,
        folder: choice.folder,
      });
    if (choice.folder === 'club') return;
    sync
      .create(choice.folder, choice.templateId)
      .then((document) => dispatch({ type: 'doc/add', document }))
      .catch(() => setProblem('That file was not created. Try again.'));
  };
  const layout = (
    <LayoutGroup
      round={round}
      state={state}
      dispatch={dispatch}
      sidebar={hasSidebar(round)}
    />
  );

  return (
    <div
      ref={root}
      className="flex min-h-screen flex-col bg-background text-ink"
    >
      <RoundHeader round={round} />
      {parts ? parts.stage : <VideoStage round={round} />}
      {parts ? (
        parts.controls(layout)
      ) : (
        <RoundControls
          round={round}
          state={state}
          dispatch={dispatch}
          layout={layout}
        />
      )}
      {parts?.below}
      {(problem ?? notice) ? (
        <p role="alert" className="px-3 py-1 text-sm text-live">
          {problem ?? notice}
        </p>
      ) : null}
      <PaneDivider
        pane="video"
        label="Resize video and workspace"
        value={video}
        onResize={(startPx, deltaPx) =>
          dispatch({ type: 'layout/resize', pane: 'video', startPx, deltaPx })
        }
        onNudge={(key) =>
          dispatch({ type: 'layout/nudge', pane: 'video', key })
        }
      />
      <Workspace
        round={round}
        state={state}
        dispatch={dispatch}
        onEdit={sync?.change}
      />
      <CommandPalette
        open={state.paletteOpen}
        documents={state.documents}
        onChoose={(choice) => {
          choose(choice);
          if (choice.kind === 'open') dispatch({ type: 'palette/close' });
        }}
        onClose={() => dispatch({ type: 'palette/close' })}
      />
    </div>
  );
}
