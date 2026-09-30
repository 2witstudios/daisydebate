const base =
  'flex min-h-12 items-center gap-2 border-b-3 px-4 text-base font-strong whitespace-nowrap no-underline hover:no-underline';

/** A hub tab link; the selected one takes the accent and an underline. */
export const watchTabClass = (selected: boolean): string =>
  `${base} ${selected ? 'border-accent text-accent' : 'border-transparent text-ink'}`;
