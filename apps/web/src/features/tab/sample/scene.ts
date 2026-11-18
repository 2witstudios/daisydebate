/**
 * Who is looking at the sample tournament, and when. The screens run on
 * sample data until wiring gives them a signed-in viewer and a clock, so the
 * walk page (`/tournaments/walk`) keeps both choices in one cookie.
 */
export const sampleViewers = [
  'host',
  'coach',
  'parent',
  'competitor',
  'judge',
  'visitor',
] as const;
export type SampleViewer = (typeof sampleViewers)[number];

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
export const sampleScales = ['normal', 'large'] as const;
export type SampleScale = (typeof sampleScales)[number];

export type SampleScene = {
  readonly viewer: SampleViewer;
  readonly moment: SampleMoment;
  readonly scale: SampleScale;
};

export const SAMPLE_SCENE_COOKIE = 'daisy.tab-sample';

/** Anyone who has not chosen is a competitor in the middle of the prelims. */
export const defaultSampleScene: SampleScene = {
  viewer: 'competitor',
  moment: 'prelims',
  scale: 'normal',
};

const isViewer = (value: string): value is SampleViewer =>
  (sampleViewers as readonly string[]).includes(value);
const isMoment = (value: string): value is SampleMoment =>
  (sampleMoments as readonly string[]).includes(value);
const isScale = (value: string): value is SampleScale =>
  (sampleScales as readonly string[]).includes(value);

/**
 * The cookie is untrusted: anything but a known viewer and moment reads as
 * the default, and anything but a known scale (or none, as cookies written
 * before the large variant have) reads as the normal one.
 */
export function parseSampleScene(value: string | undefined): SampleScene {
  const [viewer = '', moment = '', scale = ''] = (value ?? '').split('.');
  if (!isViewer(viewer) || !isMoment(moment)) return defaultSampleScene;
  return { viewer, moment, scale: isScale(scale) ? scale : 'normal' };
}

export const serializeSampleScene = (scene: SampleScene): string =>
  `${scene.viewer}.${scene.moment}.${scene.scale}`;

/** True when the scene asks for the large variant of the sample tournament. */
export const atScale = (scene: SampleScene): boolean => scene.scale === 'large';

/** Only the sample host holds a grant, so only the host reaches the host area. */
export const holdsGrant = (scene: SampleScene): boolean =>
  scene.viewer === 'host';

export const sampleViewerLabels: Readonly<Record<SampleViewer, string>> = {
  host: 'Host',
  coach: 'Coach',
  parent: 'Parent',
  competitor: 'Competitor',
  judge: 'Judge',
  visitor: 'Signed out',
};

export const sampleScaleLabels: Readonly<Record<SampleScale, string>> = {
  normal: 'As drawn',
  large: 'At scale',
};

export const sampleMomentLabels: Readonly<Record<SampleMoment, string>> = {
  before: 'Before entries close',
  prelims: 'Round 3 running',
  break: 'Prelims finished',
  elims: 'Semifinals live',
  finished: 'Certified',
};
