import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icon/icon';
import styles from './nav-item.module.css';

export type NavItemChild = {
  readonly href: string;
  readonly label: string;
};

export type NavItemRenderProps = {
  readonly href: string;
  readonly icon: IconName;
  readonly label: string;
  readonly active: boolean;
  /** Void action: commits this route as active in the shell state. */
  readonly commitActiveRoute: () => void;
  /** Optional sub-navigation revealed on hover and keyboard focus. */
  readonly subItems?: readonly NavItemChild[] | undefined;
};

export function renderNavItem(props: NavItemRenderProps): ReactNode {
  const { href, icon, label, active, commitActiveRoute, subItems } = props;
  const hasChildren = subItems !== undefined && subItems.length > 0;
  return (
    <span className={styles.wrapper}>
      <Link
        href={href}
        className={[styles.navItem, active ? styles.active : '']
          .filter(Boolean)
          .join(' ')}
        aria-current={active ? 'page' : undefined}
        onClick={commitActiveRoute}
      >
        <Icon name={icon} size={18} />
        <span className={styles.label}>{label}</span>
        {hasChildren ? (
          <span className={styles.caret} aria-hidden="true">
            <Icon name="chevronRight" size={14} />
          </span>
        ) : null}
      </Link>
      {hasChildren ? (
        <span className={styles.flyout}>
          {subItems.map((child) => (
            <Link
              key={child.href}
              href={child.href}
              className={styles.flyoutItem}
              onClick={commitActiveRoute}
            >
              {child.label}
            </Link>
          ))}
        </span>
      ) : null}
    </span>
  );
}
