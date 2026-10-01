const base = 'h-2 w-full overflow-hidden rounded-round bg-surface-overlay';

/** The reading-time bar: red when over the limit, the accent otherwise. */
export const timeBarClass = (over: boolean): string =>
  `${base} ${over ? 'accent-live' : 'accent-accent'}`;
