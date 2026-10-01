const base =
  'inline-flex h-8 w-8 items-center justify-center rounded-round border text-sm';

/** A day in the week strip: trained days are filled, rest days outlined. */
export const dayClass = (trained: boolean): string =>
  `${base} ${trained ? 'border-transparent bg-accent text-accent-ink' : 'border-border text-ink-faint'}`;
