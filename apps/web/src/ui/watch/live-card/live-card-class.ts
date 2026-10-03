import type { LiveCard } from '../../../features/watch/live-card';

type Step = LiveCard['progress'][number];

const steps = (ranked: boolean): Readonly<Record<Step, string>> => ({
  done: ranked ? 'bg-hue-clay' : 'bg-hue-sky',
  current: ranked ? 'bg-hue-clay opacity-50' : 'bg-hue-sky opacity-50',
  upcoming: 'bg-surface-overlay',
});

const base = 'h-1 flex-1 rounded-round';

/**
 * One segment of a debate's progress bar: done, in progress or to come, in
 * the debate's own hue (ADR 0051): clay for ranked, sky for casual.
 */
export const progressStepClass = (step: Step, ranked: boolean): string =>
  `${base} ${steps(ranked)[step]}`;

/** The mode's hue on a card's hover border. */
export const modeBorderClass = (ranked: boolean): string =>
  ranked ? 'hover:border-hue-clay' : 'hover:border-hue-sky';
