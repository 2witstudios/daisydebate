'use client';

import { NavItem } from '../../../../components/nav-item/nav-item';
import { useFriendsOnline } from '../../../../friends/use-friends-online';
import { friendsLabel, memberDestinations } from '../destinations';

/** Friends in the rail, with how many are online on the icon and in its name. */
export function FriendsLink() {
  const online = useFriendsOnline(true) ?? 0;
  const { href, icon, label } = memberDestinations.friends;
  return (
    <NavItem
      href={href}
      icon={icon}
      label={friendsLabel(online)}
      title={label}
      badge={
        online > 0 ? (
          <span
            aria-hidden="true"
            className="absolute top-0 right-0 flex h-shell-count min-w-shell-count items-center justify-center rounded-round bg-online px-1 text-shell-count leading-shell-count font-semibold text-background tabular-nums"
          >
            {online}
          </span>
        ) : null
      }
    />
  );
}
