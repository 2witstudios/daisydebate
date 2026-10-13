import Link from 'next/link';
import type { SpectatorSocial } from '../../../features/watch/social';
import type { SpectateQuery } from '../../../features/watch/spectate-query';
import { spectateHref } from '../../../features/watch/spectate-query';
import { InertButton } from '../inert-button/inert-button';
import { cn } from '../../cn';

/**
 * Spectator reactions and chat. Both are sample, non-mutating UI for now:
 * every control is inert. The realtime chat and reaction
 * operations replace this one module.
 */

export type ReactionsProps = {
  readonly reactions: SpectatorSocial['reactions'];
  readonly open: boolean;
};

/** Anonymous reaction totals; debaters and judges see them after the debate. */
export function Reactions({ reactions, open }: ReactionsProps) {
  return (
    <section aria-label="Reactions" className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {reactions.map((reaction) => (
          <InertButton
            key={reaction.id}
            action="react"
            className={cn(!open && 'opacity-50')}
          >
            {`${reaction.label} ${reaction.count}`}
          </InertButton>
        ))}
      </div>
      {open ? null : (
        <p className="text-xs text-ink-faint">Reactions are closed.</p>
      )}
    </section>
  );
}

export type ChatMessagesProps = {
  readonly id: string;
  readonly query: SpectateQuery;
  readonly messages: SpectatorSocial['messages'];
  readonly open: boolean;
};

/** The spectator chat's messages, each with a report link while it is open. */
export function ChatMessages({ id, query, messages, open }: ChatMessagesProps) {
  return (
    <ul aria-label="Chat messages" className="flex flex-col gap-3">
      {messages.map((message) => (
        <li key={message.id} className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col text-sm">
            {message.text === null ? (
              <span className="text-ink-faint italic">
                A message was removed by a moderator.
              </span>
            ) : (
              <>
                <span className="flex items-baseline gap-2">
                  <span className="font-strong text-ink">{`@${message.handle}`}</span>
                  <span className="text-xs text-ink-faint">{message.at}</span>
                </span>
                <span className="text-ink-muted">{message.text}</span>
              </>
            )}
          </div>
          {message.text !== null && open ? (
            <Link
              href={spectateHref(id, {
                ...query,
                report: { kind: 'message', id: message.id },
              })}
              aria-label="Report this message"
              className="flex min-h-room-target items-center px-2 text-xs text-ink-faint"
            >
              Report
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export type ChatComposerProps = {
  readonly chatRules: string;
  readonly open: boolean;
};

/** The inert composer under slow mode, or the closed notice once ended. */
export function ChatComposer({ chatRules, open }: ChatComposerProps) {
  if (!open)
    return (
      <p className="border-t border-border p-3 text-sm text-ink-muted">
        Chat closed
      </p>
    );
  return (
    <div className="flex flex-col gap-2 border-t border-border p-3">
      <label htmlFor="chat-draft" className="sr-only">
        Message spectators
      </label>
      <div className="flex gap-2">
        <input
          id="chat-draft"
          type="text"
          maxLength={200}
          className="h-10 min-w-0 flex-1 rounded-md border border-border bg-surface-sunken px-3 text-base text-ink"
        />
        <InertButton action="chat" variant="primary">
          Send
        </InertButton>
      </div>
      <span className="text-xs text-ink-faint">{`Slow mode · ${chatRules}`}</span>
    </div>
  );
}
