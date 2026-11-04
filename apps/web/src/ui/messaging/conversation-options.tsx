import { DismissibleDetails } from '../components/dismissible-details/dismissible-details';
import { navFlyoutLinkClass } from '../components/nav-item/nav-item-class';
import { Icon } from '../components/icon/icon';
import { ConversationLink as Link } from './conversation-navigation';

const tool =
  'flex size-10 cursor-pointer list-none items-center justify-center rounded-sm text-ink-muted hover:bg-surface-overlay hover:text-ink';

/** A conversation's options: a native disclosure, so it opens before any script. */
export function ConversationOptions({
  channelId,
  isGroup,
}: {
  readonly channelId: string;
  readonly isGroup: boolean;
}) {
  return (
    <DismissibleDetails
      className="relative"
      summaryClassName={tool}
      summaryAriaLabel="Conversation options"
      summaryTitle="Conversation options"
      summary={<Icon name="dots" />}
    >
      <div className="absolute top-full right-0 z-30 mt-1 flex w-flyout flex-col gap-1 rounded-md border border-border bg-surface-raised p-2 shadow-3">
        <Link
          href={`/messages/${channelId}/preferences`}
          className={navFlyoutLinkClass}
        >
          Conversation preferences
        </Link>
        {isGroup ? (
          <Link
            href={`/messages/groups/${channelId}/manage`}
            className={navFlyoutLinkClass}
          >
            Group membership
          </Link>
        ) : null}
        <Link href="/messages/contacts" className={navFlyoutLinkClass}>
          Contact safety
        </Link>
      </div>
    </DismissibleDetails>
  );
}
