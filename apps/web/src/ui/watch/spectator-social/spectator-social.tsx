import type { SpectatorSocial } from '../../../features/watch/social';

/**
 * What the audience said, read-only. Posting and reacting arrive with their
 * real operations and need an account (SPECT-1.4).
 */

export type ReactionsProps = {
  readonly reactions: SpectatorSocial['reactions'];
  readonly open: boolean;
};

/** Anonymous reaction totals; debaters and judges see them after the Round. */
export function Reactions({ reactions, open }: ReactionsProps) {
  return (
    <section aria-label="Reactions" className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-2 text-sm text-ink-muted">
        {reactions.map((reaction) => (
          <li key={reaction.id}>{`${reaction.label} ${reaction.count}`}</li>
        ))}
      </ul>
      {open ? null : (
        <p className="text-xs text-ink-faint">Reactions are closed.</p>
      )}
    </section>
  );
}

export type ChatMessagesProps = {
  readonly messages: SpectatorSocial['messages'];
};

/** The spectator chat's messages. */
export function ChatMessages({ messages }: ChatMessagesProps) {
  return (
    <ul aria-label="Chat messages" className="flex flex-col gap-3">
      {messages.map((message) => (
        <li key={message.id} className="flex flex-col text-sm">
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
        </li>
      ))}
    </ul>
  );
}
