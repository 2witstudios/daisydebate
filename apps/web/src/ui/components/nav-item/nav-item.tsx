'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { renderNavItem } from './nav-item.render';
import type { IconName } from '../icon/icon';
import type { NavItemChild } from './nav-item.render';

export type NavItemProps = {
  readonly href: string;
  readonly icon: IconName;
  readonly label: string;
  readonly title?: string | undefined;
  readonly subItems?: readonly NavItemChild[] | undefined;
  /** Other routes that belong to this item without a link of their own. */
  readonly alsoActive?: readonly string[] | undefined;
  readonly badge?: ReactNode;
};

/** Exact for `/`; otherwise also active for that route's own descendants. */
export const matchesRoute = (
  pathname: string | null,
  href: string,
): boolean => {
  if (pathname === null) return false;
  return href === '/'
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
};

/**
 * True when the path is the item's route, one of its sub-items' routes, or
 * one of the routes it also covers.
 */
export const itemActive = (
  pathname: string | null,
  href: string,
  subItems: readonly NavItemChild[] = [],
  alsoActive: readonly string[] = [],
): boolean =>
  matchesRoute(pathname, href) ||
  subItems.some((child) => matchesRoute(pathname, child.href)) ||
  alsoActive.some((route) => matchesRoute(pathname, route));

export function NavItem({
  href,
  icon,
  label,
  title,
  subItems,
  alsoActive,
  badge,
}: NavItemProps) {
  // The URL is the single source of truth for the active route, so
  // deep links and back/forward mark the right item, including on a
  // descendant of this item's own route or of one of its sub-items.
  const pathname = usePathname();
  return renderNavItem({
    href,
    icon,
    label,
    title,
    active: itemActive(pathname, href, subItems, alsoActive),
    subItems,
    badge,
  });
}
