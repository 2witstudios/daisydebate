'use client';

import { useMessagesUnread } from '../../../../messaging/messages-unread-provider';
import { NavItem } from '../../../../components/nav-item/nav-item';
import { memberDestinations, messagesLabel } from '../destinations';
import { UnreadBadge } from './notifications-link';

/** Messages in the rail, with Messaging's unread count on the icon and in its name. */
export function MessagesLink({ extended }: { readonly extended?: boolean }) {
  const unread = useMessagesUnread();
  const { href, icon, label } = memberDestinations.messages;
  return (
    <NavItem
      href={href}
      icon={icon}
      label={messagesLabel(unread)}
      title={label}
      word={label}
      extended={extended}
      badge={<UnreadBadge unread={unread} />}
    />
  );
}
