import { sampleEventResultsView } from './results';
import type { SampleScene } from './scene';
import { type EventResults, bracketOf, eventResultsOf } from '../../results';

export const readEventResults = (
  slug: string,
  scene: SampleScene,
): EventResults | null => {
  const sample = sampleEventResultsView(slug, scene);
  return sample === null
    ? null
    : eventResultsOf(sample.read, {
        bracket: bracketOf(sample.bracket, sample.wallClock),
        wallClock: sample.wallClock,
      });
};
