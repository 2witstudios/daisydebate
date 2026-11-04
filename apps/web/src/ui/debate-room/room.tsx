'use client';

import type { LocalPublication } from '../../features/round-media/model/media-publication';
import {
  useLayoutEffect,
  useReducer,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { tileHeightFor } from '../../features/debate-room/layout';
import type { PhonePanel } from '../../features/debate-room/workspace';
import { cn } from '../cn';
import { BallotStatus } from './ballot-status';
import {
  CommandPalette,
  type PaletteChoice,
} from '../documents/command-palette';
import { PhoneActions, RoundControls } from './controls';
import type { DocumentSync } from '../documents/document-sync';
import { openId, openTitle } from '../../features/documents/open-documents';
import { driveApi } from '../documents/drive-api';
import { useDrive } from '../documents/use-drive';
import type { SaveState } from '../documents/document-pane';
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
import { initialRoomState, phonePanelOf, reduceRoom } from './room-state';
import type { RoundSnapshot } from './round';
import { RoundBar } from './round-bar';
import { chatUnread, ROUND_SIDEBAR_ID, RoundSidebar } from './round-sidebar';
import {
  CURRENT_ROUND_TAB,
  FIRST_ROUND_TAB,
  ROUND_TAB_BAR,
  RoundTabs,
} from './round-tabs';
import { usePaletteShortcut } from '../documents/use-palette-shortcut';
import { useDocumentSync } from '../documents/use-document-sync';

/** Writes the tile height as a custom property (CSSOM, so the CSP allows it). */
function useTileHeight(height: number) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    root.current?.style.setProperty('--room-tile-height', `${height}px`);
  }, [height]);
  return root;
}

const DOCUMENT_ID = 'open-document';
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

type RoomProps = {
  readonly round: RoundSnapshot;
  readonly media?: ReactNode;
  readonly publication?: LocalPublication;
  readonly transcript?: ReactNode;
  /** Page-level notices; they live inside the frame so it always fits. */
  readonly notices?: ReactNode;
  readonly actions?: ReactNode;
  /** The member's documents; a preview without it shows none. */
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
  const phonePanel = phonePanelOf(state);
  useFocusReturn(state.filesOpen, phonePanel);
  const { problem } = useDocumentSync(sync, dispatch, state.tabs.open);
  const drive = useDrive({
    sync,
    opened: state.opened,
    dispatch,
  });
  const hydrated = useHydrated();
  const unread = chatUnread(round, state);
  const alerts = [...new Set([props.notice, problem, drive.problem])].filter(
    Boolean,
  );
  const create = () => drive.createDocument(null);
  const choose = (choice: PaletteChoice) => {
    dispatch({ type: 'palette/close' });
    if (choice.kind === 'new') create();
    else if (choice.kind === 'new-folder') drive.createFolder(null);
    else drive.open(choice.documentId, choice.title);
  };
  // Until script runs the phone tabs cannot switch, so every panel stays
  // readable, stacked in one scrolling column.
  const phoneHides = (...panels: readonly PhonePanel[]) =>
    hydrated && !panels.includes(phonePanel) && 'max-compact:hidden';
  return (
    <div ref={root} className="flex room-frame flex-col bg-background text-ink">
      <RoundBar round={round} leave={props.leave ?? noLeave} />
      {props.notices}
      <section
        aria-label="Round"
        className="room-stage flex shrink-0 items-center gap-6 border-b border-border px-4 py-3 max-compact:flex-col max-compact:items-stretch max-compact:gap-2 max-compact:py-2"
      >
        {props.media}
        <RoundControls
          actions={props.actions}
          publication={props.publication ?? null}
          round={round}
        />
      </section>
      {alerts.map((message) => (
        <p
          key={message}
          role="alert"
          className="shrink-0 px-4 py-1 text-sm text-live"
        >
          {message}
        </p>
      ))}
      <BallotStatus round={round} />
      <div
        data-room-workspace
        className={cn('flex min-h-0 flex-1', !hydrated && 'room-stacked')}
      >
        <FilesSidebar
          round={round}
          state={state}
          dispatch={dispatch}
          drive={drive}
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
            onRetry={drive.open}
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
          <RoomDetails round={round} />
        </div>
      </div>
      <PhoneActions round={round} actions={props.actions} />
      <RoundTabs
        state={state}
        dispatch={dispatch}
        unread={unread}
        hydrated={hydrated}
      />
      <CommandPalette
        mode={state.palette}
        documents={state.opened.map((open) => ({
          id: openId(open),
          title: openTitle(open),
        }))}
        search={driveApi.search}
        onChoose={choose}
        onClose={() => dispatch({ type: 'palette/close' })}
      />
    </div>
  );
}
