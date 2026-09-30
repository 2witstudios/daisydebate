import type { SpectatePane } from '../../../features/watch/spectate-query';

/**
 * The phone shows one pane at a time, chosen by `?pane=`; wider screens show
 * speeches and chat together. About is a phone-only pane.
 */
export function paneClass(pane: SpectatePane, active: SpectatePane): string {
  if (pane === 'about')
    return pane === active ? 'hidden max-compact:flex' : 'hidden';
  return pane === active ? '' : 'max-compact:hidden';
}

const tab =
  'flex min-h-12 flex-1 items-center justify-center border-b-3 px-4 text-base font-strong no-underline hover:no-underline';

/** A phone pane tab link; the selected one takes the accent. */
export const paneTabClass = (selected: boolean): string =>
  `${tab} ${selected ? 'border-accent text-accent' : 'border-transparent text-ink'}`;

const step =
  'flex flex-1 flex-col items-center gap-1 rounded-sm py-2 text-xs font-strong';

const steps = {
  done: 'bg-accent-soft text-accent',
  current: 'bg-accent text-accent-ink',
  upcoming: 'bg-surface-overlay text-ink-muted',
} as const;

/** One step of the phase timeline: done, current or upcoming. */
export const timelineStepClass = (state: keyof typeof steps): string =>
  `${step} ${steps[state]}`;
