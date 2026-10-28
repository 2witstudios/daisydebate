import Link from 'next/link';

/** A survivor's conversations with deleted accounts (DEC-126); none renders nothing. */
export function RetainedConversationList({
  conversations,
}: {
  readonly conversations: readonly {
    readonly channelId: string;
    readonly messages: number;
  }[];
}) {
  if (conversations.length === 0) return null;
  return (
    <section aria-labelledby="retained-heading" className="flex flex-col gap-3">
      <h2
        id="retained-heading"
        className="text-sm font-semibold text-ink-muted"
      >
        Conversations with deleted accounts
      </h2>
      <ul className="flex flex-col gap-2">
        {conversations.map((conversation) => (
          <li key={conversation.channelId}>
            <Link href={`/messages/retained/${conversation.channelId}`}>
              Conversation with a deleted account
            </Link>{' '}
            <span className="text-sm text-ink-muted">
              ({conversation.messages} of your messages)
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
