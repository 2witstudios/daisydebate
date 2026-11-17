'use client';

import { badgeText } from '../../../../../features/notifications/shell-policy';
import { NavItem } from '../../../../components/nav-item/nav-item';
import { useNotificationShell } from '../../../../notifications/notification-shell-provider';
import { memberDestinations, notificationsLabel } from '../destinations';

/** The count a member's badge shows: the shell's unread, or nothing. */
export const useUnreadNotifications = (): number =>
  useNotificationShell()?.unread ?? 0;

/** The badge itself, on an icon: nothing to say is nothing drawn. */
export function UnreadBadge({ unread }: { readonly unread: number }) {
  const text = badgeText(unread);
  return text === null ? null : (
    <span
      aria-hidden="true"
      className="absolute top-0 right-0 flex h-shell-count min-w-shell-count items-center justify-center rounded-round bg-accent px-1 text-shell-count leading-shell-count font-semibold text-accent-ink tabular-nums"
    >
      {text}
    </span>
  );
}

/** Notifications in the rail, with the unread count on the icon and in its name. */
export function NotificationsLink({
  extended,
}: {
  readonly extended?: boolean;
}) {
  const unread = useUnreadNotifications();
  const { href, icon, label } = memberDestinations.notifications;
  return (
    <NavItem
      href={href}
      icon={icon}
      label={notificationsLabel(unread)}
      title={label}
      word={label}
      extended={extended}
      badge={<UnreadBadge unread={unread} />}
    />
  );
}
