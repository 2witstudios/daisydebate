import Link from 'next/link';
import type { MessagingConversation } from '../../features/messaging/conversation';
type Message = MessagingConversation['messages'][number];
function MessageRow({
  message,
  actorId,
  channelId,
}: {
  readonly channelId: string;
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
          <Link
            href={`/messages/${channelId}/attachments?messageId=${message.id}`}
          >
            Attachments
          </Link>
          <Link
            href={`/messages/${channelId}/reactions?messageId=${message.id}`}
          >
            Reactions
          </Link>
          {message.authorActorId === actorId ? (
            <Link
              href={`/messages/${channelId}/message?messageId=${message.id}${message.sequence < Number.MAX_SAFE_INTEGER ? `&before=${message.sequence + 1}` : ''}`}
            >
              Edit or remove your message
            </Link>
          ) : null}
          {message.authorActorId === actorId ? (
            <Link
              href={`/messages/${channelId}/attachments?messageId=${message.id}&attach=1`}
            >
              Attach file
            </Link>
          ) : null}
        </>
      )}
    </li>
  );
}
export function MessageHistory({
  history,
  actorId,
  searchQuery,
}: {
  readonly searchQuery?: string;
  readonly history: MessagingConversation;
  readonly actorId: string | null;
}) {
  return (
    <>
      {history.messages.length === 0 ? (
        <p className="text-ink-muted">
          {searchQuery === undefined
            ? 'No messages yet.'
            : 'No matching messages.'}
        </p>
      ) : (
        <ol aria-label="Message history" className="flex flex-col gap-3">
          {[...history.messages].reverse().map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              actorId={actorId}
              channelId={history.channelId}
            />
          ))}
        </ol>
      )}
      {history.nextBefore ? (
        <Link
          href={`/messages/${history.channelId}?before=${history.nextBefore.sequence}${searchQuery === undefined ? '' : `&query=${encodeURIComponent(searchQuery)}`}`}
        >
          Earlier messages
        </Link>
      ) : null}
    </>
  );
}
