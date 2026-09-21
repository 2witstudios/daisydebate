'use client';

import { usePathname } from 'next/navigation';
import { dispatch, transactions } from '../../transactions';
import { renderNavItem } from './nav-item.render';
import type { IconName } from '../icon/icon';
import type { NavItemChild } from './nav-item.render';

export type NavItemProps = {
  readonly href: string;
  readonly icon: IconName;
  readonly label: string;
  readonly subItems?: readonly NavItemChild[] | undefined;
};

export function NavItem({ href, icon, label, subItems }: NavItemProps) {
  // The URL is the single source of truth for the active route, so
  // deep links and back/forward mark the right item. Clicking still
  // mirrors the route into the shell store for non-URL consumers.
  const pathname = usePathname();
  const active = pathname === href;
  return renderNavItem({
    href,
    icon,
    label,
    active,
    commitActiveRoute: () => dispatch(transactions.setActiveRoute, href),
    subItems,
  });
}
