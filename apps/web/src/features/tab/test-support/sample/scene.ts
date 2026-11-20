/** The viewer and tournament state supplied by a Tab fixture. */
type SampleViewer =
  'host' | 'coach' | 'parent' | 'competitor' | 'judge' | 'visitor';

export const sampleMoments = [
  'before',
  'prelims',
  'break',
  'elims',
  'finished',
] as const;
export type SampleMoment = (typeof sampleMoments)[number];

/**
 * How big the sample tournament is: the canvas's ordinary one, or the large
 * variant (120 rooms, 200 entries, 60 schools, 150 judges, a bracket of 64)
 * that shows how each screen behaves at scale.
 */
type SampleScale = 'normal' | 'large';

export type SampleScene = {
  readonly viewer: SampleViewer;
  readonly moment: SampleMoment;
  readonly scale: SampleScale;
};

/** True when the scene asks for the large variant of the sample tournament. */
export const atScale = (scene: SampleScene): boolean => scene.scale === 'large';
