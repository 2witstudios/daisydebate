'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { renderNavItem } from './nav-item.render';
import type { IconName } from '../icon/icon';
import type { NavItemChild } from './nav-item.render';
import type { NavFlyoutAlign } from './nav-item-class';

export type NavItemProps = {
  readonly href: string;
  readonly icon: IconName;
  readonly label: string;
  readonly title?: string | undefined;
  /** The word beside the icon when the rail is extended; the label when omitted. */
  readonly word?: string | undefined;
  readonly subItems?: readonly NavItemChild[] | undefined;
  /** Other routes that belong to this item without a link of their own. */
  readonly alsoActive?: readonly string[] | undefined;
  /** Which way its flyout opens; a link at the foot opens upward. */
  readonly flyoutAlign?: NavFlyoutAlign | undefined;
  readonly badge?: ReactNode;
  /** The rail's mode: extended shows words, mini is icon-only (ADR 0091). */
  readonly extended?: boolean | undefined;
  /** A foot control: a square icon with its name as screen-reader text only. */
  readonly iconOnly?: boolean | undefined;
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
  word,
  subItems,
  alsoActive,
  flyoutAlign,
  badge,
  extended,
  iconOnly,
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
    word,
    active: itemActive(pathname, href, subItems, alsoActive),
    subItems,
    flyoutAlign,
    badge,
    extended,
    iconOnly,
  });
}
