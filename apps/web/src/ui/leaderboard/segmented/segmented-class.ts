const base =
  'inline-flex min-h-10 items-center rounded-sm px-3 text-sm font-strong whitespace-nowrap no-underline hover:no-underline';

/** A segmented link; the selected one takes the accent. */
export const segmentClass = (selected: boolean): string =>
  `${base} ${selected ? 'bg-accent text-accent-ink hover:text-accent-ink' : 'text-ink-muted hover:text-ink'}`;
