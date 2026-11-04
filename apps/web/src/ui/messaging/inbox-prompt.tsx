'use client';
import { InboxEmpty } from './inbox-empty';
import { useInbox } from './inbox-provider';

/** The prompt where nothing is open, from the list's own read. */
export function InboxPrompt() {
  const inbox = useInbox();
  return (
    <InboxEmpty
      hasConversations={inbox.entries.length > 0 || inbox.nextAfter !== null}
    />
  );
}
