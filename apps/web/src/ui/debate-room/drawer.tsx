'use client';

import { useMemo, type Dispatch, type KeyboardEvent } from 'react';
import {
  systemClock,
  systemId,
  type Clock,
  type IdGenerator,
} from '@daisy/clock';
import { totalUnread, unreadByChannel } from '../../features/debate-room/chat';
import {
  buildTree,
  drawerTabs,
  roundKindOf,
  visibleAgents,
  visibleChannels,
  visibleClub,
  type DrawerTab,
} from '../../features/debate-room/workspace';
import { cn } from '../cn';
import { DrawerFiles } from './drawer-files';
import { AgentPanel, Badge, ChatPanel, type PanelProps } from './drawer-panels';
import { DrawerRoom } from './drawer-room';
import type { RoomAction, RoomState } from './room-state';
import type { RoundSnapshot } from './round';

type Props = {
  readonly round: RoundSnapshot;
  readonly state: RoomState;
  readonly dispatch: Dispatch<RoomAction>;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
};

export const DRAWER_ID = 'round-drawer';

export const tabNames: Readonly<Record<DrawerTab, string>> = {
  files: 'Files',
  chat: 'Chat',
  ai: 'AI',
  room: 'Room',
};

/** Unread chat across the channels this round shows. */
export function chatUnread(round: RoundSnapshot, state: RoomState): number {
  const channels = visibleChannels(
    round.channels,
    roundKindOf(round.competition),
  );
  return totalUnread(
    unreadByChannel(state.messages, channels, state.readMarkers, round.self.id),
  );
}

/** The transcript is written while the speeches run, complete once they end. */
const transcriptOf = (round: RoundSnapshot) => {
  if (!round.transcribing) return null;
  return round.phase === 'judging' ? 'complete' : 'live';
};

const tabId = (tab: DrawerTab) => `round-drawer-tab-${tab}`;

function DrawerTabs({
  tabs,
  state,
  dispatch,
  unread,
}: {
  readonly tabs: readonly DrawerTab[];
  readonly state: RoomState;
  readonly dispatch: Dispatch<RoomAction>;
  readonly unread: number;
}) {
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next =
      tabs[(tabs.indexOf(state.drawer) + step + tabs.length) % tabs.length];
    if (!next) return;
    dispatch({ type: 'drawer/tab', tab: next });
    document.getElementById(tabId(next))?.focus();
  };
  const unseen = (tab: DrawerTab) =>
    tab === 'chat' && state.drawer !== 'chat' ? unread : 0;
  return (
    <div
      role="tablist"
      aria-label="Drawer"
      onKeyDown={key}
      className="m-3 grid auto-cols-fr grid-flow-col gap-px rounded-md bg-surface-sunken p-1 max-narrow:hidden"
    >
      {tabs.map((tab) => (
        <button
          key={tab}
          id={tabId(tab)}
          type="button"
          role="tab"
          aria-selected={state.drawer === tab}
          aria-controls={`${DRAWER_ID}-panel`}
          aria-label={
            unseen(tab) > 0
              ? `${tabNames[tab]}, ${unseen(tab)} unread`
              : undefined
          }
          tabIndex={state.drawer === tab ? 0 : -1}
          className={cn(
            'inline-flex h-room-target cursor-pointer items-center justify-center gap-1 rounded-sm text-sm',
            state.drawer === tab
              ? 'bg-surface-overlay font-strong text-ink'
              : 'text-ink-muted hover:text-ink',
          )}
          onClick={() => dispatch({ type: 'drawer/tab', tab })}
        >
          {tabNames[tab]}
          <Badge count={unseen(tab)} />
        </button>
      ))}
    </div>
  );
}

function DrawerPanel(props: PanelProps) {
  const { round, state, dispatch } = props;
  const kind = roundKindOf(round.competition);
  const tree = useMemo(
    () => buildTree(state.documents, visibleClub(round.clubName, kind)),
    [state.documents, round.clubName, kind],
  );
  switch (state.drawer) {
    case 'files':
      return (
        <DrawerFiles
          tree={tree}
          active={state.tabs.active}
          dispatch={dispatch}
          transcript={transcriptOf(round)}
        />
      );
    case 'chat':
      return (
        <ChatPanel
          {...props}
          channels={visibleChannels(round.channels, kind)}
        />
      );
    case 'ai':
      return (
        <AgentPanel {...props} agents={visibleAgents(round.agents, kind)} />
      );
    case 'room':
      return <DrawerRoom round={round} />;
  }
}

/**
 * The one closable drawer: Files, Chat, AI and Room. A rated round drops
 * the AI tab, the agents and every club channel.
 */
export function RoundDrawer({
  round,
  state,
  dispatch,
  clock = systemClock,
  ids = systemId,
}: Props) {
  const padded = state.drawer === 'files' || state.drawer === 'room';
  return (
    <aside
      id={DRAWER_ID}
      aria-label="Round drawer"
      className={cn(
        'hidden min-h-0 w-round-drawer shrink-0 flex-col border-r border-border bg-surface max-narrow:w-full max-narrow:border-r-0',
        state.drawerOpen && 'narrow:flex',
        state.phoneDrawer && 'max-narrow:flex',
      )}
    >
      <DrawerTabs
        tabs={drawerTabs(roundKindOf(round.competition))}
        state={state}
        dispatch={dispatch}
        unread={chatUnread(round, state)}
      />
      <div
        id={`${DRAWER_ID}-panel`}
        role="tabpanel"
        aria-labelledby={tabId(state.drawer)}
        className={cn(
          'flex min-h-0 flex-1 flex-col max-narrow:pt-3',
          padded && 'px-3 pb-3',
        )}
      >
        <DrawerPanel
          round={round}
          state={state}
          dispatch={dispatch}
          clock={clock}
          ids={ids}
        />
      </div>
    </aside>
  );
}
