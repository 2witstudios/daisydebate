'use client';

import {
  useLayoutEffect,
  useReducer,
  useRef,
  useSyncExternalStore,
  type Dispatch,
  type ReactNode,
} from 'react';
import { systemClock, systemId } from '@daisy/clock';
import { tileHeightFor } from '../../features/debate-room/layout';
import type { PhonePanel } from '../../features/debate-room/workspace';
import { cn } from '../cn';
import { BallotStatus } from './ballot-status';
import { CommandPalette, type PaletteChoice } from './command-palette';
import { PhoneActions, RoundControls } from './controls';
import type { DocumentSync } from './document-sync';
import type { SaveState } from './document-pane';
import { RoomDetails } from './room-details';
import {
  FILES_ID,
  FILES_SHOW_ID,
  FILES_HIDE_ID,
  FilesSidebar,
} from './files-sidebar';
import { focusReturnTarget, firstShown } from './focus-return';
import type { LeaveLinks } from './leave-room';
import { usePhoneBreakpoint } from './phone-breakpoint';
import { RoomDocument } from './room-document';
import { initialRoomState, reduceRoom, type RoomAction } from './room-state';
import type { RoundSnapshot } from './round';
import { RoundBar } from './round-bar';
import { chatUnread, ROUND_SIDEBAR_ID, RoundSidebar } from './round-sidebar';
import {
  CURRENT_ROUND_TAB,
  FIRST_ROUND_TAB,
  ROUND_TAB_BAR,
  RoundTabs,
} from './round-tabs';
import { usePaletteShortcut } from './use-palette-shortcut';
import { useDocumentSync } from './use-document-sync';

/** Writes the tile height as a custom property (CSSOM, so the CSP allows it). */
function useTileHeight(height: number) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    root.current?.style.setProperty('--room-tile-height', `${height}px`);
  }, [height]);
  return root;
}

const DOCUMENT_ID = 'round-document';
const PHONE_ROOM_ID = 'round-phone-room';

const noSubscribe = () => () => {};

/** False in the server's markup and until hydration: every panel then shows. */
const useHydrated = () =>
  useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

const focusRegions = () => [
  document.getElementById(FILES_ID),
  document.getElementById(DOCUMENT_ID),
  document.getElementById(ROUND_SIDEBAR_ID),
  document.getElementById(PHONE_ROOM_ID),
  document.querySelector(ROUND_TAB_BAR),
];

const focusTargets = () => [
  document.getElementById(FILES_SHOW_ID),
  document.getElementById(FILES_HIDE_ID),
  document.querySelector<HTMLElement>(CURRENT_ROUND_TAB),
  document.querySelector<HTMLElement>(FIRST_ROUND_TAB),
];

/**
 * Focus inside Files when it closes, or inside a panel a phone tab hides,
 * goes back to the way to reopen it or the phone tab now showing. A
 * breakpoint crossing hides or returns regions through the media query
 * alone, without a state change: the browser strands any focus the hidden
 * region held on the body, so the crossing brings it back itself.
 */
function useFocusReturn(filesOpen: boolean, phone: PhonePanel) {
  const phoneLayout = usePhoneBreakpoint();
  useLayoutEffect(() => {
    focusReturnTarget(
      document.activeElement,
      focusRegions(),
      focusTargets(),
    )?.focus();
  }, [filesOpen, phone]);
  const crossed = useRef(phoneLayout);
  useLayoutEffect(() => {
    if (crossed.current === phoneLayout) return;
    crossed.current = phoneLayout;
    const active = document.activeElement;
    const targets = focusTargets();
    const target =
      focusReturnTarget(active, focusRegions(), targets) ??
      (active === document.body ? firstShown(targets) : null);
    target?.focus();
  }, [phoneLayout]);
}

const noLeave: LeaveLinks = {
  confirming: false,
  stayHref: '',
  confirmHref: '?leave',
  leaveHref: '/lobby',
};

type Problem = (message: string) => void;

/** Create a plain document on the server, or in memory without one. */
function newDocument(
  sync: DocumentSync | undefined,
  dispatch: Dispatch<RoomAction>,
  setProblem: Problem,
) {
  return () => {
    if (!sync)
      return dispatch({
        type: 'doc/create',
        id: systemId.next(),
        now: systemClock.now(),
      });
    sync
      .create()
      .then((document) => dispatch({ type: 'doc/add', document }))
      .catch(() => setProblem('That file was not created. Try again.'));
  };
}

type RoomProps = {
  readonly round: RoundSnapshot;
  readonly media?: ReactNode;
  readonly transcript?: ReactNode;
  /** Page-level notices; they live inside the frame so it always fits. */
  readonly notices?: ReactNode;
  readonly actions?: ReactNode;
  /** Server-backed documents; without it the room keeps them in memory. */
  readonly sync?: DocumentSync;
  /** A standing problem the round's owner reports (saves failing). */
  readonly notice?: string | null;
  readonly save?: SaveState | null;
  readonly leave?: LeaveLinks;
};

/**
 * The debater's round, outside the app shell. The round section (bar, video,
 * clock and actions) runs the full width; the workspace starts on one line
 * below it: Files, the open documents and the Round sidebar, each scrolling
 * on its own. Nothing depends on the Round's type: every Round offers the
 * same help (ADR 0097).
 */
export function DebateRoom({ round, sync, ...props }: RoomProps) {
  const [state, dispatch] = useReducer(reduceRoom, round, initialRoomState);
  const root = useTileHeight(tileHeightFor(round.phase));
  usePaletteShortcut(dispatch);
  useFocusReturn(state.filesOpen, state.phone);
  const { problem, setProblem } = useDocumentSync(sync, dispatch);
  const hydrated = useHydrated();
  const unread = chatUnread(round, state);
  const alert = problem ?? props.notice ?? null;
  const create = newDocument(sync, dispatch, setProblem);
  const choose = (choice: PaletteChoice) => {
    if (choice.kind === 'new') return create();
    dispatch({ type: 'tabs/open', id: choice.documentId });
    dispatch({ type: 'palette/close' });
  };
  // Until script runs the phone tabs cannot switch, so every panel stays
  // readable, stacked in one scrolling column.
  const phoneHides = (...panels: readonly PhonePanel[]) =>
    hydrated && !panels.includes(state.phone) && 'max-compact:hidden';
  const transcribing = props.transcript != null;
  return (
    <div ref={root} className="flex room-frame flex-col bg-background text-ink">
      <RoundBar round={round} leave={props.leave ?? noLeave} />
      {props.notices}
      <section
        aria-label="Round"
        className="room-stage flex shrink-0 items-center gap-6 border-b border-border px-4 py-3 max-compact:flex-col max-compact:items-stretch max-compact:gap-2 max-compact:py-2"
      >
        {props.media}
        <RoundControls actions={props.actions} round={round} />
      </section>
      {alert ? (
        <p role="alert" className="shrink-0 px-4 py-1 text-sm text-live">
          {alert}
        </p>
      ) : null}
      <BallotStatus round={round} />
      <div
        data-room-workspace
        className={cn('flex min-h-0 flex-1', !hydrated && 'room-stacked')}
      >
        <FilesSidebar
          round={round}
          state={state}
          dispatch={dispatch}
          onNew={create}
          transcribing={transcribing}
          phoneClass={phoneHides('files')}
        />
        <div
          id={DOCUMENT_ID}
          className={cn('flex min-w-0 flex-1 flex-col', phoneHides('doc'))}
        >
          <RoomDocument
            {...(sync ? { sync } : {})}
            state={state}
            dispatch={dispatch}
            onEdit={sync?.change}
            onNew={create}
            save={props.save ?? null}
          />
        </div>
        <RoundSidebar
          round={round}
          state={state}
          dispatch={dispatch}
          transcript={props.transcript}
          phoneClass={phoneHides('transcript', 'channels', 'ai')}
        />
        <div
          id={PHONE_ROOM_ID}
          className={cn(
            'flex-col overflow-y-auto p-4 compact:hidden',
            phoneHides('room') || 'flex flex-1',
          )}
        >
          <RoomDetails round={round} transcribing={transcribing} />
        </div>
      </div>
      <PhoneActions round={round} actions={props.actions} />
      <RoundTabs state={state} dispatch={dispatch} unread={unread} />
      <CommandPalette
        open={state.paletteOpen}
        documents={state.documents}
        onChoose={choose}
        onClose={() => dispatch({ type: 'palette/close' })}
      />
    </div>
  );
}
