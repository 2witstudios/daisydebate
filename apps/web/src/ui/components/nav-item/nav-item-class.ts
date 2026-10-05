import { cn } from '../../cn';

const navItemBase =
  'flex items-center gap-3 rounded-md px-4 py-3 text-md font-semibold no-underline transition-colors duration-120 ease-standard hover:no-underline icons:justify-center icons:px-0';

/** Classes for the primary link; each state owns its colors. */
export const navItemClass = (active: boolean): string =>
  cn(
    navItemBase,
    active
      ? 'bg-accent-soft text-accent-strong hover:bg-accent-soft hover:text-accent-strong'
      : 'text-ink-muted hover:bg-surface hover:text-ink',
  );

/** Classes for the flyout caret; it shows while the wrapper is hovered or focused. */
export const navCaretClass = (active: boolean): string =>
  cn(
    'inline-flex opacity-0 transition-opacity duration-120 ease-standard group-focus-within:opacity-100 group-hover:opacity-100 icons:hidden',
    active ? 'text-accent-strong' : 'text-ink-faint',
  );

/**
 * Classes for a flyout panel beside its row, shown while the wrapper is
 * hovered or focused. It hangs from the row's top, or rises from its bottom
 * at the foot of the sidebar.
 */
export const navFlyoutClass = (anchor: 'top' | 'bottom'): string =>
  cn(
    'invisible absolute left-full z-30 ml-2 flex min-w-flyout -translate-x-flyout-shift flex-col gap-1 rounded-md border border-border bg-surface-raised p-2 opacity-0 shadow-3 transition-all duration-120 ease-standard group-focus-within:visible group-focus-within:translate-x-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-x-0 group-hover:opacity-100',
    anchor === 'top' ? 'top-0' : 'bottom-0',
  );

/** Classes for a link inside a flyout. */
export const navFlyoutLinkClass =
  'block rounded-sm px-3 py-2 text-sm font-semibold whitespace-nowrap text-ink-muted no-underline hover:bg-surface-overlay hover:text-ink hover:no-underline';
