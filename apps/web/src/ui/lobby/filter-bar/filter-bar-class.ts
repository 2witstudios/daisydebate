/** Shared by the search box and every select in the filter form. */
export const controlClass =
  'h-10 min-w-0 rounded-md border border-border bg-surface-raised px-3 text-base text-ink max-compact:h-12';

export const filterBarClass = 'flex flex-wrap items-center gap-x-3 gap-y-4';

/** The divider under the tab row; it pulls up into the row gap. */
export const dividerClass =
  'order-3 -mt-4 h-px basis-full bg-border max-compact:order-2';

/** The phone Filters button: hidden on desktop, where the controls show. */
export const summaryClass =
  'hidden h-12 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface-raised px-3 text-base font-strong text-ink max-compact:order-4 max-compact:flex';

/**
 * The details body. On desktop it dissolves into the form so its controls
 * sit in the filter rows; on the phone it is a panel under the results line.
 */
export const panelClass =
  'details-content:contents max-compact:details-content:order-6 max-compact:details-content:flex max-compact:details-content:basis-full max-compact:details-content:flex-col max-compact:details-content:gap-3 max-compact:details-content:rounded-lg max-compact:details-content:border max-compact:details-content:border-border max-compact:details-content:bg-surface max-compact:details-content:p-3';
