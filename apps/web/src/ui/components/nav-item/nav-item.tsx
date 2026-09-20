'use client';

import { useUiState } from '../../store/store';
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
  const activeRoute = useUiState((state) => state.resources.activeRoute);
  return renderNavItem({
    href,
    icon,
    label,
    active: activeRoute === href,
    commitActiveRoute: () => dispatch(transactions.setActiveRoute, href),
    subItems,
  });
}
