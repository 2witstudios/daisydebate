import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icon/icon';
import {
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
  /** The accessible name, counts included ("Friends, 4 online"). */
  readonly label: string;
  /** The tooltip; the label when omitted. */
  readonly title?: string | undefined;
  readonly active: boolean;
  /** Optional sub-navigation revealed on hover and keyboard focus. */
  readonly subItems?: readonly NavItemChild[] | undefined;
  /** A decorative count over the icon; the label already says it. */
  readonly badge?: ReactNode;
};

/** One icon-only rail link: the label is screen-reader text and a tooltip. */
export function renderNavItem(props: NavItemRenderProps): ReactNode {
  const { href, icon, label, title, active, subItems, badge } = props;
  const hasChildren = subItems !== undefined && subItems.length > 0;
  return (
    <span className="group relative block">
      <Link
        href={href}
        title={title ?? label}
        className={navItemClass(active)}
        aria-current={active ? 'page' : undefined}
      >
        <Icon name={icon} size={20} />
        <span className="sr-only">{label}</span>
        {badge}
      </Link>
      {hasChildren ? (
        <span className={navFlyoutClass}>
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
