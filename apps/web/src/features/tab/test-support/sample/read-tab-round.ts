import { sampleTabRoundView } from './tab-round';
import type { SampleScene } from './scene';
import { type RunningRound, runningRoundOf } from '../../tab-round';

export const readRunningRound = (
  slug: string,
  event: string,
  round: string,
  scene: SampleScene,
): RunningRound | null => {
  const sample = sampleTabRoundView(slug, event, round, scene);
  return sample === null ? null : runningRoundOf(sample.read, sample.context);
};
