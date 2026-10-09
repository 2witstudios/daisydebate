import Link from 'next/link';
import type { MessagingConversation } from '../../features/messaging/conversation';
type Message = MessagingConversation['messages'][number];
function MessageRow({
  message,
  actorId,
}: {
  readonly message: Message;
  readonly actorId: string | null;
}) {
  return (
    <li className="rounded-lg border border-border bg-surface-raised p-4">
      {'unavailable' in message ? (
        <p className="text-sm text-ink-muted">Message unavailable</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-ink-muted">
            {message.authorActorId === actorId ? 'You' : 'Participant'} ·{' '}
            <time dateTime={message.createdAt}>
              {message.createdAt.replace('T', ' ').replace('.000Z', ' UTC')}
            </time>
            {message.editedAt ? ' · edited' : ''}
          </p>
          <p className="break-words whitespace-pre-wrap text-ink">
            {message.text}
          </p>
        </>
      )}
    </li>
  );
}
export function MessageHistory({
  history,
  actorId,
}: {
  readonly history: MessagingConversation;
  readonly actorId: string | null;
}) {
  return (
    <>
      {history.messages.length === 0 ? (
        <p className="text-ink-muted">No messages yet.</p>
      ) : (
        <ol aria-label="Message history" className="flex flex-col gap-3">
          {[...history.messages].reverse().map((message) => (
            <MessageRow key={message.id} message={message} actorId={actorId} />
          ))}
        </ol>
      )}
      {history.nextBefore ? (
        <Link
          href={`/messages/${history.channelId}?before=${history.nextBefore.sequence}`}
        >
          Earlier messages
        </Link>
      ) : null}
    </>
  );
}
