'use client';

import type { Dispatch } from 'react';
import {
  systemClock,
  systemId,
  type Clock,
  type IdGenerator,
} from '@daisy/clock';
import { totalUnread, unreadByChannel } from '../../features/debate-room/chat';
import {
  sidebarTabs,
  visibleAgents,
  visibleChannels,
  type Agent,
  type Channel,
} from '../../features/debate-room/workspace';
import { cn } from '../cn';
import type { RoomAction, RoomState } from './room-state';
import type { RoundSnapshot } from './round';
import { AgentThread, ChatThread, Composer } from './threads';

type Props = {
  readonly round: RoundSnapshot;
  readonly state: RoomState;
  readonly dispatch: Dispatch<RoomAction>;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
};

const pill = (on: boolean, ink: string) =>
  cn(
    'inline-flex h-6 cursor-pointer items-center gap-1 rounded-round border px-3 text-xs font-strong',
    on
      ? cn('border-transparent bg-surface-overlay', ink)
      : 'border-border text-ink-muted',
  );

function Badge({ count }: { readonly count: number }) {
  if (count === 0) return null;
  return (
    <span className="min-w-4 rounded-round bg-gold px-1 text-center text-2xs font-bold text-background tabular-nums">
      {count}
    </span>
  );
}

function AgentPane({
  round,
  state,
  dispatch,
  clock,
  ids,
  agents,
}: Required<Props> & { readonly agents: readonly Agent[] }) {
  const agent = agents.find((a) => a.id === state.agentId) ?? agents[0];
  if (!agent) return null;
  const ask = (text: string) =>
    dispatch({
      type: 'agent/ask',
      agentId: agent.id,
      turn: { id: ids.next(), from: 'you', text },
    });
  return (
    <>
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
            onClick={() => dispatch({ type: 'sidebar/agent', agentId: a.id })}
          >
            {a.title}
          </button>
        ))}
      </div>
      <AgentThread
        turns={[
          ...(round.agentThreads[agent.id] ?? []),
          ...(state.asked[agent.id] ?? []),
        ]}
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
            className="h-6 cursor-pointer rounded-round border border-border-strong px-3 text-xs"
            onClick={() => ask(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
      <Composer placeholder={`Ask ${agent.title}`} tone="ai" onSend={ask} />
    </>
  );
}

function ChatPane({
  round,
  state,
  dispatch,
  clock,
  ids,
  channels,
}: Required<Props> & { readonly channels: readonly Channel[] }) {
  const channel = channels.find((c) => c.id === state.channelId) ?? channels[0];
  if (!channel) return null;
  const unread = unreadByChannel(
    state.messages,
    channels,
    state.readMarkers,
    round.self.id,
  );
  const send = (text: string) =>
    dispatch({
      type: 'chat/send',
      message: {
        id: ids.next(),
        channelId: channel.id,
        author: { id: round.self.id, name: round.self.name, role: 'debater' },
        text,
        sentAt: clock.now(),
      },
    });
  return (
    <>
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
                type: 'sidebar/channel',
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
      <ChatThread
        messages={state.messages.filter((m) => m.channelId === channel.id)}
        selfId={round.self.id}
      />
      <Composer
        placeholder={
          channel.scope === 'round'
            ? 'Message judge and opponent'
            : `Message #${channel.title}`
        }
        tone="chat"
        onSend={send}
      />
    </>
  );
}

/** Chat and AI beside the document, so the AI can edit what is open. */
export function RoomSidebar({
  round,
  state,
  dispatch,
  clock = systemClock,
  ids = systemId,
}: Props) {
  const channels = visibleChannels(round.channels, round.kind);
  const agents = visibleAgents(round.agents, round.kind);
  const unread = totalUnread(
    unreadByChannel(state.messages, channels, state.readMarkers, round.self.id),
  );
  const all = { round, state, dispatch, clock, ids };
  const tabClass = (tab: string) =>
    cn(
      'inline-flex h-8 cursor-pointer items-center justify-center gap-1 rounded-sm text-sm font-strong',
      state.sidebar === tab
        ? cn('bg-surface-overlay', tab === 'ai' ? 'text-hue-plum' : 'text-ink')
        : 'text-ink-muted',
    );
  return (
    <aside
      aria-label="Sidebar"
      className="flex min-w-0 flex-1 flex-col bg-surface"
    >
      <div
        role="tablist"
        aria-label="Sidebar"
        className="grid auto-cols-fr grid-flow-col gap-px border-b border-border bg-background p-1"
      >
        {sidebarTabs(round.kind).map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={state.sidebar === tab}
            className={tabClass(tab)}
            onClick={() => dispatch({ type: 'sidebar/tab', tab })}
          >
            {tab === 'ai' ? 'AI' : 'Chat'}
            {tab === 'chat' && state.sidebar === 'ai' ? (
              <Badge count={unread} />
            ) : null}
          </button>
        ))}
      </div>
      {state.sidebar === 'ai' ? (
        <AgentPane {...all} agents={agents} />
      ) : (
        <ChatPane {...all} channels={channels} />
      )}
    </aside>
  );
}
