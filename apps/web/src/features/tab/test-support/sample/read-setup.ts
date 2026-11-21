import { sampleSetup } from './setup';
import type { SampleScene } from './scene';
import { type TournamentSetup, tournamentSetupOf } from '../../setup';

export const readSetup = (
  slug: string,
  scene: SampleScene,
): TournamentSetup | null => {
  const sample = sampleSetup(slug, scene);
  return sample === null
    ? null
    : tournamentSetupOf(sample.reads, sample.context);
};
