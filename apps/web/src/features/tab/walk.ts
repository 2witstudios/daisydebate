import { sampleWalk } from './sample/walk';
import type { SampleScene } from './sample/scene';

export type WalkStep = { readonly label: string; readonly href: string };

/**
 * Every screen the chosen viewer can open at the chosen moment, in the order
 * a tournament runs. It is how the sample tournament is walked until the
 * screens have real viewers; it goes when wiring replaces the sample.
 */
export type Walk = {
  readonly scene: SampleScene;
  readonly steps: readonly WalkStep[];
};

export const readWalk = (scene: SampleScene): Walk => sampleWalk(scene);
