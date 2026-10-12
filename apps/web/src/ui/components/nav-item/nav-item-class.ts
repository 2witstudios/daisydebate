import { cn } from '../../cn';

const navItemBase =
  'relative flex size-nav-target items-center justify-center rounded-md no-underline transition-colors duration-120 ease-standard hover:no-underline';

/** Classes for a rail link; each state owns its colors. */
export const navItemClass = (active: boolean): string =>
  cn(
    navItemBase,
    active
      ? 'bg-accent text-accent-ink hover:bg-accent-strong hover:text-accent-ink'
      : 'text-ink-muted hover:bg-surface-overlay hover:text-ink',
  );

/**
 * Classes for a flyout panel beside its rail link, shown while the wrapper is
 * hovered or focused. It hangs from the link's top.
 */
export const navFlyoutClass =
  'invisible absolute top-0 left-full z-30 ml-2 flex min-w-flyout -translate-x-flyout-shift flex-col gap-1 rounded-md border border-border bg-surface-raised p-2 opacity-0 shadow-3 transition-all duration-120 ease-standard group-focus-within:visible group-focus-within:translate-x-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-x-0 group-hover:opacity-100';

/** Classes for a link inside a flyout. */
export const navFlyoutLinkClass =
  'block rounded-sm px-3 py-2 text-sm font-semibold whitespace-nowrap text-ink-muted no-underline hover:bg-surface-overlay hover:text-ink hover:no-underline';
