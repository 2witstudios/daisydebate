import { ShellLink as Link } from '../layout/app-shell/shell-link';
import { buttonClass } from '../components/button/button-class';
import { DaisyMark } from '../components/daisy-mark/daisy-mark';

/**
 * Nothing open: the prompt in the conversation pane, or with no conversations
 * at all the one action that starts one. Without an open pane the list stands
 * alone below compact, so this says nothing there the list does not.
 */
export function InboxEmpty({
  hasConversations,
}: {
  readonly hasConversations: boolean;
}) {
  return (
    <section
      aria-labelledby="inbox-empty-heading"
      className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <DaisyMark size={48} variant="primary" />
      <h2 id="inbox-empty-heading" className="font-display text-xl font-bold">
        {hasConversations ? 'Pick a conversation' : 'No messages yet'}
      </h2>
      <Link href="/messages/new" className={buttonClass('primary')}>
        New message
      </Link>
    </section>
  );
}
