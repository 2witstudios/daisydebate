const tab =
  'flex min-h-12 flex-1 items-center justify-center border-b-3 px-4 text-base font-strong no-underline hover:no-underline';

/** A pane tab link; the selected one takes the accent. */
export const paneTabClass = (selected: boolean): string =>
  `${tab} ${selected ? 'border-accent text-accent' : 'border-transparent text-ink'}`;

const step =
  'flex min-w-0 flex-1 items-center truncate rounded-sm px-2 py-2 text-xs font-strong';

const steps = {
  done: 'bg-surface-overlay text-ink-faint',
  current: 'bg-accent text-accent-ink',
  upcoming: 'border border-border text-ink-muted',
} as const;

/** One step of the phase timeline: done, current or upcoming. */
export const timelineStepClass = (state: keyof typeof steps): string =>
  `${step} ${steps[state]}`;
