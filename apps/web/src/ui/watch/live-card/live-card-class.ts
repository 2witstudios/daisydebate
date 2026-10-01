import type { LiveCard } from '../../../features/watch/live-card';

type Step = LiveCard['progress'][number];

const steps: Readonly<Record<Step, string>> = {
  done: 'bg-accent',
  current: 'bg-accent opacity-50',
  upcoming: 'bg-surface-overlay',
};

const base = 'h-1 flex-1 rounded-round';

/** One segment of a debate's progress bar: done, in progress or to come. */
export const progressStepClass = (step: Step): string =>
  `${base} ${steps[step]}`;

/** Ranked reads in the accent color, casual stays muted. */
export const modeTextClass = (ranked: boolean): string =>
  ranked ? 'font-strong text-accent' : 'font-strong text-ink-muted';
