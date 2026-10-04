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

export type ChatProps = {
  readonly id: string;
  readonly query: SpectateQuery;
  readonly social: SpectatorSocial;
  readonly open: boolean;
  readonly className?: string;
};

/** The spectator chat: messages, a report link on each, and an inert composer. */
export function Chat({ id, query, social, open, className }: ChatProps) {
  return (
    <aside
      aria-label="Spectator chat"
      className={cn(
        'flex min-h-0 flex-col rounded-lg border border-border bg-surface shadow-1',
        className,
      )}
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-xs font-bold tracking-widest text-ink-muted uppercase">
          Spectator chat
        </h2>
        {open ? (
          <span className="text-xs text-ink-faint">Slow mode</span>
        ) : null}
      </header>
      <ul aria-label="Chat messages" className="flex flex-col gap-3 p-4">
        {social.messages.map((message) => (
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
                className="text-xs text-ink-faint"
              >
                Report
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-border p-4">
          <label htmlFor="chat-draft" className="sr-only">
            Message the spectators
          </label>
          <div className="flex gap-2">
            <input
              id="chat-draft"
              type="text"
              disabled
              maxLength={200}
              placeholder="Message"
              className="h-10 min-w-0 flex-1 rounded-md border border-border bg-surface-raised px-3 text-base text-ink disabled:opacity-60"
            />
            <InertButton action="chat" variant="primary">
              Send
            </InertButton>
          </div>
          <span className="text-xs text-ink-faint">{social.chatRules}</span>
        </div>
      ) : (
        <p className="border-t border-border p-4 text-sm text-ink-muted">
          Chat closed
        </p>
      )}
    </aside>
  );
}
