import type { ReplayPane } from '../../../features/watch/replay-query';

/**
 * The phone shows one pane at a time, chosen by `?pane=`; wider screens show
 * the transcript beside the result and sharing panels.
 */
export const replayPaneClass = (
  group: ReplayPane,
  active: ReplayPane,
): string => (group === active ? '' : 'max-compact:hidden');

const heights = {
  0: 'h-1',
  1: 'h-2',
  2: 'h-3',
  3: 'h-4',
  4: 'h-5',
  5: 'h-6',
} as const;

/** One bar of the reaction-density strip: taller means more reactions. */
export const densityBarClass = (level: number): string => {
  const step = Math.max(
    0,
    Math.min(5, Math.round(level)),
  ) as keyof typeof heights;
  return `${heights[step]} flex-1 rounded-round bg-accent-soft`;
};
