import Link from 'next/link';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icon/icon';
import {
  navFlyoutClass,
  navFlyoutLinkClass,
  navItemClass,
  type NavFlyoutAlign,
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
  /** The tooltip; the label when omitted. Retained at responsive icon-only widths. */
  readonly title?: string | undefined;
  readonly active: boolean;
  /**
   * The word beside the icon when the rail is extended; the label when
   * omitted. It never changes the accessible name.
   */
  readonly word?: string | undefined;
  /** Optional sub-navigation revealed on hover and keyboard focus. */
  readonly subItems?: readonly NavItemChild[] | undefined;
  /** Which way its flyout opens; a link at the foot opens upward. */
  readonly flyoutAlign?: NavFlyoutAlign | undefined;
  /** A decorative count over the icon; the label already says it. */
  readonly badge?: ReactNode;
  /** The rail's mode: extended shows words, mini is icon-only (ADR 0091). */
  readonly extended?: boolean | undefined;
};

/**
 * The name inside a rail link: the visible word beside the icon when the rail
 * is extended, the label as screen-reader text otherwise, and only the
 * screen-reader label for an icon-only foot control.
 */
function linkName({
  label,
  word,
  extended,
}: Pick<NavItemRenderProps, 'label' | 'word' | 'extended'>) {
  if (extended && word !== undefined && word !== label) {
    return (
      <>
        <span aria-hidden="true" className="max-rail:sr-only">
          {word}
        </span>
        <span className="sr-only">{label}</span>
      </>
    );
  }
  // The accessible name is always the full label; the word is the extended
  // rail's visible decoration only.
  return (
    <span className={extended ? 'max-rail:sr-only' : 'sr-only'}>
      {extended ? (word ?? label) : label}
    </span>
  );
}

/** The markup of a rail link and its flyout, shared by every rail mode. */
export function renderNavItem(props: NavItemRenderProps): ReactNode {
  const {
    href,
    icon,
    label,
    title,
    active,
    subItems,
    flyoutAlign,
    badge,
    extended,
    word,
  } = props;
  const hasChildren = subItems !== undefined && subItems.length > 0;
  return (
    <span className="group relative block">
      <Link
        href={href}
        // The tooltip stays at every width: CSS alone hides the extended
        // words below 1101px, and a hover name is the only discovery left.
        title={title ?? label}
        className={navItemClass(active, extended)}
        aria-current={active ? 'page' : undefined}
      >
        <Icon name={icon} size={20} />
        {linkName({ label, word, extended })}
        {badge}
      </Link>
      {hasChildren ? (
        <span className={navFlyoutClass(flyoutAlign)}>
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
