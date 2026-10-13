'use client';

import type { Dispatch } from 'react';
import type { Clock, IdGenerator } from '@daisy/clock';
import { unreadByChannel } from '../../features/debate-room/chat';
import type { Agent, Channel } from '../../features/debate-room/workspace';
import { cn } from '../cn';
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

export function AgentPanel({
  round,
  state,
  dispatch,
  clock,
  agents,
}: PanelProps & { readonly agents: readonly Agent[] }) {
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
              onClick={() => dispatch({ type: 'drawer/agent', agentId: a.id })}
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

export function ChatPanel({
  round,
  state,
  dispatch,
  clock,
  channels,
}: PanelProps & { readonly channels: readonly Channel[] }) {
  const channel = channels.find((c) => c.id === state.channelId) ?? channels[0];
  if (!channel) return null;
  const unread = unreadByChannel(
    state.messages,
    channels,
    state.readMarkers,
    round.self.id,
  );
  return (
    <>
      {channels.length > 1 ? (
        <div
          role="group"
          aria-label="Channels"
          className="flex flex-wrap gap-1 border-b border-border p-2"
        >
          {channels.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={c.id === channel.id}
              className={pill(c.id === channel.id, 'text-ink')}
              onClick={() =>
                dispatch({
                  type: 'drawer/channel',
                  channelId: c.id,
                  now: clock.now(),
                })
              }
            >
              # {c.title}
              {c.id === channel.id ? null : <Badge count={unread[c.id] ?? 0} />}
            </button>
          ))}
        </div>
      ) : (
        <h2 className="px-4 pb-2 text-sm font-strong"># {channel.title}</h2>
      )}
      <ChatThread
        messages={state.messages.filter((m) => m.channelId === channel.id)}
        selfId={round.self.id}
      />
      <Composer label={`Message # ${channel.title}`} tone="chat" />
    </>
  );
}
