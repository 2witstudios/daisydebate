'use client';

import {
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from 'react';
import { systemClock, systemId } from '@daisy/clock';
import {
  effectivePreset,
  videoBounds,
  videoHeightFor,
  workspaceMinHeight,
} from '../../features/debate-room/layout';
import { cn } from '../cn';
import { BallotStatus } from './ballot-status';
import { BotStage } from './bot-stage';
import { CommandPalette, type PaletteChoice } from './command-palette';
import { LayoutMenu, PhoneActions, RoundControls } from './controls';
import type { DocumentSync } from './document-sync';
import type { SaveState } from './document-pane';
import { chatUnread, DRAWER_ID, DRAWER_TOGGLE_ID, RoundDrawer } from './drawer';
import { focusReturnTarget, firstShown } from './focus-return';
import type { LeaveLinks } from './leave-room';
import { useNarrowBreakpoint } from './narrow-breakpoint';
import { VideoDivider } from './video-divider';
import { RoomDocument } from './room-document';
import { initialRoomState, reduceRoom, type RoomAction } from './room-state';
import type { RoundSnapshot } from './round';
import { RoundBar } from './round-bar';
import {
  CURRENT_ROUND_TAB,
  FIRST_ROUND_TAB,
  ROUND_TAB_BAR,
  RoundTabs,
} from './round-tabs';
import { VideoStage } from './stage';
import { usePaletteShortcut } from './use-palette-shortcut';
import { useDocumentSync } from './use-document-sync';

/** Writes the video size as custom properties (CSSOM, so the CSP allows it). */
function useVideoVariables(video: number) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const style = root.current?.style;
    if (!style) return;
    style.setProperty('--room-video', `${video}px`);
    style.setProperty('--room-workspace', `${workspaceMinHeight(video)}px`);
  }, [video]);
  return root;
}

const COLUMN_ID = 'round-column';

/**
 * Focus inside the drawer when it closes, or inside the column a phone tab
 * hides, goes back to the drawer toggle or the phone tab now showing.
 * A breakpoint crossing hides or returns the drawer and the tab bar through
 * the media query alone, without a state change: the browser strands any
 * focus the hidden region held on the body, so the crossing brings it back
 * to the visible way back itself.
 */
function useFocusReturn(drawerOpen: boolean, phoneDrawer: boolean) {
  const narrow = useNarrowBreakpoint();
  useLayoutEffect(() => {
    const active = document.activeElement;
    const target = focusReturnTarget(
      active,
      [
        document.getElementById(DRAWER_ID),
        document.getElementById(COLUMN_ID),
        document.querySelector(ROUND_TAB_BAR),
      ],
      [
        document.getElementById(DRAWER_TOGGLE_ID),
        document.querySelector<HTMLElement>(CURRENT_ROUND_TAB),
        document.querySelector<HTMLElement>(FIRST_ROUND_TAB),
      ],
    );
    target?.focus();
  }, [drawerOpen, phoneDrawer]);
  const crossed = useRef(narrow);
  useLayoutEffect(() => {
    if (crossed.current === narrow) return;
    crossed.current = narrow;
    const active = document.activeElement;
    const regions = [
      document.getElementById(DRAWER_ID),
      document.getElementById(COLUMN_ID),
      document.querySelector(ROUND_TAB_BAR),
    ];
    const targets = [
      document.getElementById(DRAWER_TOGGLE_ID),
      document.querySelector<HTMLElement>(CURRENT_ROUND_TAB),
      document.querySelector<HTMLElement>(FIRST_ROUND_TAB),
    ];
    const target =
      focusReturnTarget(active, regions, targets) ??
      (active === document.body ? firstShown(targets) : null);
    target?.focus();
  }, [narrow]);
}
const noLeave: LeaveLinks = {
  confirming: false,
  stayHref: '',
  confirmHref: '?leave',
  leaveHref: '/lobby',
};

type Problem = (message: string) => void;

/** A palette choice: open a file, or create one on the server or in memory. */
function choiceHandler(
  sync: DocumentSync | undefined,
  dispatch: Dispatch<RoomAction>,
  setProblem: Problem,
) {
  return (choice: PaletteChoice) => {
    if (choice.kind === 'open') {
      dispatch({ type: 'tabs/open', id: choice.documentId });
      return dispatch({ type: 'palette/close' });
    }
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
}

type RoomProps = {
  readonly round: RoundSnapshot;
  readonly media?: ReactNode;
  readonly transcript?: ReactNode;
  readonly actions?: ReactNode;
  /** Server-backed documents; without it the room keeps them in memory. */
  readonly sync?: DocumentSync;
  /** A standing problem the round's owner reports (saves failing). */
  readonly notice?: string | null;
  readonly save?: SaveState | null;
  readonly leave?: LeaveLinks;
};

/**
 * The debater's round, outside the app shell: the round bar, the closable
 * drawer, then the video, the controls and the document.
 */
export function DebateRoom({ round, sync, ...props }: RoomProps) {
  const reducer = useMemo(() => reduceRoom(round), [round]);
  const [state, dispatch] = useReducer(reducer, round, initialRoomState);
  const video = videoHeightFor(state.layout, round.phase);
  const preset = effectivePreset(state.layout, round.phase);
  const Stage = round.opponent.bot ? BotStage : VideoStage;
  const root = useVideoVariables(video);
  usePaletteShortcut(dispatch);
  useFocusReturn(state.drawerOpen, state.phoneDrawer);
  const { problem, setProblem } = useDocumentSync(sync, dispatch);
  const unread = chatUnread(round, state);
  const alert = problem ?? props.notice ?? null;
  return (
    <div
      ref={root}
      className="flex h-dvh flex-col overflow-hidden bg-background text-ink"
    >
      <RoundBar
        round={round}
        drawerOpen={state.drawerOpen}
        unread={unread}
        onToggleDrawer={() => dispatch({ type: 'drawer/toggle' })}
        leave={props.leave ?? noLeave}
      />
      <div className="flex min-h-0 flex-1">
        <RoundDrawer round={round} state={state} dispatch={dispatch} />
        <div
          id={COLUMN_ID}
          className={cn(
            'flex min-w-0 flex-1 flex-col overflow-y-auto',
            state.phoneDrawer && 'max-narrow:hidden',
          )}
        >
          {props.media ?? <Stage round={round} preset={preset} />}
          <RoundControls
            actions={props.actions}
            round={round}
            state={state}
            dispatch={dispatch}
            layout={
              <LayoutMenu round={round} state={state} dispatch={dispatch} />
            }
          />
          {alert ? (
            <p role="alert" className="px-4 py-1 text-sm text-live">
              {alert}
            </p>
          ) : null}
          <BallotStatus round={round} />
          {props.transcript}
          <VideoDivider
            value={video}
            min={videoBounds.min}
            max={videoBounds.max}
            onResize={(startPx, deltaPx) =>
              dispatch({ type: 'layout/resize', startPx, deltaPx })
            }
            onNudge={(key) => dispatch({ type: 'layout/nudge', key })}
          />
          <RoomDocument
            round={round}
            state={state}
            dispatch={dispatch}
            onEdit={sync?.change}
            save={props.save ?? null}
          />
        </div>
      </div>
      <PhoneActions
        round={round}
        state={state}
        dispatch={dispatch}
        actions={props.actions}
      />
      <RoundTabs
        round={round}
        state={state}
        dispatch={dispatch}
        unread={unread}
      />
      <CommandPalette
        open={state.paletteOpen}
        documents={state.documents}
        onChoose={choiceHandler(sync, dispatch, setProblem)}
        onClose={() => dispatch({ type: 'palette/close' })}
      />
    </div>
  );
}
