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

export type SampleScene = {
  readonly viewer: SampleViewer;
  readonly moment: SampleMoment;
};

export const SAMPLE_SCENE_COOKIE = 'daisy.tab-sample';

/** Anyone who has not chosen is a competitor in the middle of the prelims. */
export const defaultSampleScene: SampleScene = {
  viewer: 'competitor',
  moment: 'prelims',
};

const isViewer = (value: string): value is SampleViewer =>
  (sampleViewers as readonly string[]).includes(value);
const isMoment = (value: string): value is SampleMoment =>
  (sampleMoments as readonly string[]).includes(value);

/** The cookie is untrusted: anything but a known pair reads as the default. */
export function parseSampleScene(value: string | undefined): SampleScene {
  const [viewer = '', moment = ''] = (value ?? '').split('.');
  return isViewer(viewer) && isMoment(moment)
    ? { viewer, moment }
    : defaultSampleScene;
}

export const serializeSampleScene = (scene: SampleScene): string =>
  `${scene.viewer}.${scene.moment}`;

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

export const sampleMomentLabels: Readonly<Record<SampleMoment, string>> = {
  before: 'Before entries close',
  prelims: 'Round 3 running',
  break: 'Prelims finished',
  elims: 'Semifinals live',
  finished: 'Certified',
};
