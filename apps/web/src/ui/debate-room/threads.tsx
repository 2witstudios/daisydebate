'use client';

import type { ChatMessage } from '../../features/debate-room/chat';
import { cn } from '../cn';
import { Icon } from '../components/icon/icon';
import type { EditOutcome } from './room-state';
import type { AgentTurn } from './round';

const roleInk: Readonly<Record<ChatMessage['author']['role'], string>> = {
  judge: 'text-gold',
  debater: 'text-hue-sky',
  member: 'text-ink',
  system: 'text-ink-faint',
};

/** A channel's messages, oldest first. */
export function ChatThread({
  messages,
  selfId,
}: {
  readonly messages: readonly ChatMessage[];
  readonly selfId: string;
}) {
  return (
    <ol className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {messages.map((m) => (
        <li key={m.id} className="flex flex-col gap-1 text-sm">
          <span
            className={cn(
              'text-xs font-strong',
              m.author.id === selfId ? 'text-hue-clay' : roleInk[m.author.role],
            )}
          >
            {m.author.id === selfId ? 'You' : m.author.name}
          </span>
          <span className="leading-normal">{m.text}</span>
        </li>
      ))}
    </ol>
  );
}

type EditCardProps = {
  readonly turn: AgentTurn;
  readonly outcome: EditOutcome | undefined;
  readonly documentTitle: string;
  readonly onDecide: (outcome: EditOutcome) => void;
};

function EditCard({ turn, outcome, documentTitle, onDecide }: EditCardProps) {
  const edit = turn.edit;
  if (!edit || outcome === 'discarded') return null;
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-border-strong bg-background p-3 text-sm">
      <span className="text-xs font-strong tracking-wider text-hue-plum uppercase">
        Edit to {documentTitle}
      </span>
      {edit.removed.map((line) => (
        <del key={line} className="text-ink-faint">
          {line}
        </del>
      ))}
      {edit.added.map((line) => (
        <ins key={line} className="text-hue-teal no-underline">
          {line}
        </ins>
      ))}
      {outcome === 'applied' ? (
        <span className="pt-1 text-xs font-strong text-hue-teal">Applied</span>
      ) : (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            className="h-room-target cursor-pointer rounded-sm bg-hue-plum px-3 text-sm font-strong text-background"
            onClick={() => onDecide('applied')}
          >
            Apply
          </button>
          <button
            type="button"
            className="h-room-target cursor-pointer rounded-sm border border-border-strong px-3 text-sm text-ink-muted"
            onClick={() => onDecide('discarded')}
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}

type AgentThreadProps = {
  readonly turns: readonly AgentTurn[];
  readonly agentName: string;
  readonly edits: Readonly<Record<string, EditOutcome>>;
  readonly titleOf: (documentId: string) => string;
  readonly onDecide: (turn: AgentTurn, outcome: EditOutcome) => void;
};

/** An agent conversation; proposed edits wait for Apply or Discard. */
export function AgentThread({
  turns,
  agentName,
  edits,
  titleOf,
  onDecide,
}: AgentThreadProps) {
  return (
    <ol className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      {turns.map((turn) =>
        turn.from === 'you' ? (
          <li
            key={turn.id}
            className="ml-8 self-end rounded-md rounded-br-sm bg-surface-overlay px-3 py-2 text-sm"
          >
            {turn.text}
          </li>
        ) : (
          <li key={turn.id} className="flex flex-col gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-xs font-strong text-hue-plum">
              <Icon name="sparkle" size={13} />
              {agentName}
            </span>
            <span className="leading-normal">{turn.text}</span>
            <EditCard
              turn={turn}
              outcome={edits[turn.id]}
              documentTitle={turn.edit ? titleOf(turn.edit.documentId) : ''}
              onDecide={(outcome) => onDecide(turn, outcome)}
            />
          </li>
        ),
      )}
    </ol>
  );
}

type ComposerProps = {
  readonly label: string;
  readonly tone: 'chat' | 'ai';
};

/**
 * The message box. Nothing delivers a round message or answers an ask yet
 * (CHAT-1, ISSUE-420), so the field and Send are shown disabled (DEC-178).
 */
export function Composer({ label, tone }: ComposerProps) {
  return (
    <div className="flex gap-2 border-t border-border p-2">
      <input
        aria-label={label}
        disabled
        className="h-room-target min-w-0 flex-1 rounded-sm border border-border-strong bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
      />
      <button
        type="button"
        aria-label="Send"
        disabled
        className={cn(
          'flex size-room-target cursor-not-allowed items-center justify-center rounded-sm text-background opacity-60',
          tone === 'ai' ? 'bg-hue-plum' : 'bg-accent',
        )}
      >
        <Icon name="send" size={17} />
      </button>
    </div>
  );
}
