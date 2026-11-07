'use client';

import type { Dispatch, KeyboardEvent, ReactNode } from 'react';
import { systemClock, type Clock } from '@daisy/clock';
import { totalUnread, unreadByChannel } from '../../features/debate-room/chat';
import {
  sidebarTabs,
  type SidebarTab,
} from '../../features/debate-room/workspace';
import { cn } from '../cn';
import { AgentPanel, Badge, ChatPanel } from './sidebar-panels';
import type { RoomAction, RoomState } from './room-state';
import type { RoundSnapshot } from './round';
import { FloorChat, type FloorChatProps } from '../round-floor/floor-chat';

export const ROUND_SIDEBAR_ID = 'round-sidebar';

const sidebarNames: Readonly<Record<SidebarTab, string>> = {
  transcript: 'Transcript',
  channels: 'Channels',
  ai: 'AI chat',
};

/** Unread messages across the Round's channels. */
export function chatUnread(round: RoundSnapshot, state: RoomState): number {
  return totalUnread(
    unreadByChannel(
      state.messages,
      round.channels,
      state.readMarkers,
      round.self.id,
    ),
  );
}

const tabId = (tab: SidebarTab) => `${ROUND_SIDEBAR_ID}-tab-${tab}`;
const panelId = (tab: SidebarTab) => `${ROUND_SIDEBAR_ID}-panel-${tab}`;

/**
 * The sidebar beside the open documents: Transcript, Channels and AI chat,
 * the same in every Round. It never closes on its own. Each panel stays
 * mounted while hidden, so the transcript keeps following the Round.
 */
export function RoundSidebar({
  round,
  state,
  dispatch,
  transcript,
  phoneClass,
  clock = systemClock,
  floor,
  floorActive = true,
  floorUnread,
  onFloorUnread,
}: {
  readonly round: RoundSnapshot;
  readonly state: RoomState;
  readonly dispatch: Dispatch<RoomAction>;
  readonly transcript: ReactNode;
  /** Hides the sidebar on a phone unless one of its tabs is showing. */
  readonly phoneClass: string | false;
  readonly clock?: Clock;
  readonly floor?: FloorChatProps | undefined;
  readonly floorActive?: boolean;
  readonly floorUnread?: number | undefined;
  readonly onFloorUnread?: (count: number) => void;
}) {
  const unread = floorUnread ?? chatUnread(round, state);
  const unseen = (tab: SidebarTab) =>
    tab === 'channels' && state.sidebar !== 'channels' ? unread : 0;
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const at = sidebarTabs.indexOf(state.sidebar);
    const next =
      sidebarTabs[(at + step + sidebarTabs.length) % sidebarTabs.length];
    if (!next) return;
    dispatch({ type: 'sidebar/tab', tab: next });
    document.getElementById(tabId(next))?.focus();
  };
  const panel = (tab: SidebarTab, padded: boolean, content: ReactNode) => (
    <div
      id={panelId(tab)}
      role="tabpanel"
      aria-labelledby={tabId(tab)}
      className={cn(
        'min-h-0 flex-1 flex-col',
        state.sidebar === tab ? 'flex' : 'hidden',
        padded && 'pt-3',
      )}
    >
      {content}
    </div>
  );
  return (
    <aside
      id={ROUND_SIDEBAR_ID}
      aria-label="Round sidebar"
      className={cn(
        'flex min-h-0 round-sidebar shrink-0 flex-col border-l border-border bg-surface max-compact:flex-1 max-compact:border-l-0',
        phoneClass,
      )}
    >
      <div
        role="tablist"
        aria-label="Sidebar tabs"
        onKeyDown={key}
        className="grid h-12 shrink-0 auto-cols-fr grid-flow-col border-b border-border max-compact:hidden"
      >
        {sidebarTabs.map((tab) => (
          <button
            key={tab}
            id={tabId(tab)}
            type="button"
            role="tab"
            aria-selected={state.sidebar === tab}
            aria-controls={panelId(tab)}
            aria-label={
              unseen(tab) > 0
                ? `${sidebarNames[tab]}, ${unseen(tab)} unread`
                : undefined
            }
            tabIndex={state.sidebar === tab ? 0 : -1}
            onClick={() => dispatch({ type: 'sidebar/tab', tab })}
            className={cn(
              'inline-flex cursor-pointer items-center justify-center gap-1 border-b-2 text-sm',
              state.sidebar === tab
                ? 'border-accent font-strong text-ink'
                : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {sidebarNames[tab]}
            <Badge count={unseen(tab)} />
          </button>
        ))}
      </div>
      {panel(
        'transcript',
        false,
        transcript ?? (
          <p className="p-4 text-sm text-ink-muted">No transcript.</p>
        ),
      )}
      {panel(
        'channels',
        false,
        floor ? (
          <FloorChat
            {...floor}
            active={floorActive && state.sidebar === 'channels'}
            onUnread={onFloorUnread}
          />
        ) : (
          <ChatPanel
            round={round}
            state={state}
            dispatch={dispatch}
            clock={clock}
          />
        ),
      )}
      {panel(
        'ai',
        true,
        <AgentPanel
          round={round}
          state={state}
          dispatch={dispatch}
          clock={clock}
        />,
      )}
    </aside>
  );
}
