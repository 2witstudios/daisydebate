import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icon/icon';
import {
  navCaretClass,
  navFlyoutClass,
  navFlyoutLinkClass,
  navItemClass,
} from './nav-item-class';

export type NavItemChild = {
  readonly href: string;
  readonly label: string;
};

export type NavItemRenderProps = {
  readonly href: string;
  readonly icon: IconName;
  readonly label: string;
  readonly active: boolean;
  /** Optional sub-navigation revealed on hover and keyboard focus. */
  readonly subItems?: readonly NavItemChild[] | undefined;
};

export function renderNavItem(props: NavItemRenderProps): ReactNode {
  const { href, icon, label, active, subItems } = props;
  const hasChildren = subItems !== undefined && subItems.length > 0;
  return (
    <span className="group relative block">
      <Link
        href={href}
        className={navItemClass(active)}
        aria-current={active ? 'page' : undefined}
      >
        <Icon name={icon} size={18} />
        <span className="flex-1 whitespace-nowrap icons:sr-only">{label}</span>
        {hasChildren ? (
          <span className={navCaretClass(active)} aria-hidden="true">
            <Icon name="chevronRight" size={14} />
          </span>
        ) : null}
      </Link>
      {hasChildren ? (
        <span className={navFlyoutClass('top')}>
          {subItems.map((child) => (
            <Link
              key={child.href}
              href={child.href}
              className={navFlyoutLinkClass}
            >
              {child.label}
            </Link>
          ))}
        </span>
      ) : null}
    </span>
  );
}
