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
    <section aria-labelledby="retained-heading" className="mt-3 flex flex-col gap-2 border-t border-border p-2 pt-3">
      <h2
        id="retained-heading"
        className="text-xs font-semibold text-ink-muted"
      >
        Conversations with deleted accounts
      </h2>
      <ul className="flex list-none flex-col gap-2 text-sm">
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
