'use client';

import type { Dispatch } from 'react';
import type { Clock, IdGenerator } from '@daisy/clock';
import { unreadByChannel } from '../../features/debate-room/chat';
import { cn } from '../cn';
import { Icon } from '../components/icon/icon';
import type { RoomAction, RoomState } from './room-state';
import type { RoundSnapshot } from './round';
import { AgentThread, ChatThread, Composer } from './threads';

/** What a drawer panel reads and writes. */
export type PanelProps = {
  readonly round: RoundSnapshot;
  readonly state: RoomState;
  readonly dispatch: Dispatch<RoomAction>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
};

const pill = (on: boolean, ink: string) =>
  cn(
    'inline-flex h-room-target cursor-pointer items-center gap-1 rounded-round border px-3 text-xs font-strong',
    on
      ? cn('border-transparent bg-surface-overlay', ink)
      : 'border-border text-ink-muted',
  );

export function Badge({ count }: { readonly count: number }) {
  if (count === 0) return null;
  return (
    <span className="min-w-4 rounded-round bg-live px-1 text-center text-xs font-bold text-background tabular-nums">
      {count}
    </span>
  );
}

export function AgentPanel({ round, state, dispatch, clock }: PanelProps) {
  const agents = round.agents;
  const agent = agents.find((a) => a.id === state.agentId) ?? agents[0];
  if (!agent) return null;
  return (
    <>
      {agents.length > 1 ? (
        <div
          role="group"
          aria-label="Agents"
          className="flex flex-wrap gap-1 border-b border-border p-2"
        >
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              aria-pressed={a.id === agent.id}
              className={pill(a.id === agent.id, 'text-hue-plum')}
              onClick={() => dispatch({ type: 'agent/select', agentId: a.id })}
            >
              {a.title}
            </button>
          ))}
        </div>
      ) : null}
      <AgentThread
        turns={round.agentThreads[agent.id] ?? []}
        agentName={agent.title}
        edits={state.edits}
        titleOf={(id) => state.documents.find((d) => d.id === id)?.title ?? ''}
        onDecide={(turn, outcome) =>
          turn.edit &&
          dispatch({
            type: 'agent/edit',
            turnId: turn.id,
            outcome,
            documentId: turn.edit.documentId,
            removed: turn.edit.removed,
            added: turn.edit.added,
            now: clock.now(),
          })
        }
      />
      <div className="flex flex-wrap gap-1 px-2 pb-2">
        {(round.agentPrompts[agent.id] ?? []).map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="h-room-target cursor-not-allowed rounded-round border border-border-strong px-3 text-xs opacity-60"
            disabled
          >
            {prompt}
          </button>
        ))}
      </div>
      <Composer label={`Ask ${agent.title}`} tone="ai" />
    </>
  );
}

const listRow =
  'flex h-room-target w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-surface-raised';

/** Channels and direct messages; a thread opens in their place. */
export function ChatPanel({ round, state, dispatch, clock }: PanelProps) {
  const unread = unreadByChannel(
    state.messages,
    round.channels,
    state.readMarkers,
    round.self.id,
  );
  const channel = round.channels.find((c) => c.id === state.channelId);
  if (state.channelOpen && channel)
    return (
      <>
        <div className="flex shrink-0 items-center gap-1 border-b border-border pr-4 pl-1">
          <button
            type="button"
            aria-label="Back to channels"
            onClick={() => dispatch({ type: 'channel/list' })}
            className="flex size-room-target cursor-pointer items-center justify-center rounded-sm hover:bg-surface-raised"
          >
            <Icon name="chevronLeft" size={16} />
          </button>
          <h2 className="truncate text-sm font-strong"># {channel.title}</h2>
        </div>
        <ChatThread
          messages={state.messages.filter((m) => m.channelId === channel.id)}
          selfId={round.self.id}
        />
        <Composer label={`Message # ${channel.title}`} tone="chat" />
      </>
    );
  return (
    <nav
      aria-label="Channels"
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3"
    >
      <section className="flex flex-col gap-px">
        <h2 className="px-2 pb-1 text-xs font-strong text-ink-muted">
          Channels
        </h2>
        {round.channels.map((c) => (
          <button
            key={c.id}
            type="button"
            className={listRow}
            onClick={() =>
              dispatch({
                type: 'channel/open',
                channelId: c.id,
                now: clock.now(),
              })
            }
          >
            <span className="min-w-0 flex-1 truncate"># {c.title}</span>
            <Badge count={unread[c.id] ?? 0} />
          </button>
        ))}
      </section>
      <section className="flex flex-col gap-px">
        <h2 className="px-2 pb-1 text-xs font-strong text-ink-muted">
          Direct messages
        </h2>
        <p className="px-2 text-sm text-ink-muted">None</p>
      </section>
    </nav>
  );
}
