import { cn } from '../../cn';

const navItemBase =
  'relative flex items-center rounded-md no-underline transition-colors duration-120 ease-standard hover:no-underline';

/* Mini: the 44px square. Extended: a full-width row, icon and words. */
const miniLayout = 'size-nav-target justify-center';
const extendedLayout = 'h-nav-target w-full justify-start gap-3 px-2';

/** Classes for a rail link; each state owns its colors. */
export const navItemClass = (active: boolean, extended = false): string =>
  cn(
    navItemBase,
    extended ? extendedLayout : miniLayout,
    active
      ? 'bg-accent text-accent-ink hover:bg-accent-strong hover:text-accent-ink'
      : 'text-ink-muted hover:bg-surface-overlay hover:text-ink',
  );

/** Which edge of its rail link a flyout hangs from: a foot item opens upward. */
export type NavFlyoutAlign = 'top' | 'bottom';

const navFlyoutEdge: Record<NavFlyoutAlign, string> = {
  top: 'top-0',
  bottom: 'bottom-0',
};

/**
 * Classes for a flyout panel beside its rail link, shown while the wrapper is
 * hovered or focused. It hangs from the link's top, or from its bottom when
 * the link sits at the foot of the viewport.
 */
export const navFlyoutClass = (align: NavFlyoutAlign = 'top'): string =>
  cn(
    'invisible absolute left-full z-30 ml-2 flex min-w-flyout -translate-x-flyout-shift flex-col gap-1 rounded-md border border-border bg-surface-raised p-2 opacity-0 shadow-3 transition-all duration-120 ease-standard group-focus-within:visible group-focus-within:translate-x-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-x-0 group-hover:opacity-100',
    navFlyoutEdge[align],
  );

/** Classes for a link inside a flyout. */
export const navFlyoutLinkClass =
  'block rounded-sm px-3 py-2 text-sm font-semibold whitespace-nowrap text-ink-muted no-underline hover:bg-surface-overlay hover:text-ink hover:no-underline';
