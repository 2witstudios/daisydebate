import { sampleMoments, type SampleMoment, type SampleScene } from './scene';

/** Whether the scene's moment is at or after `moment`. */
export const reached = (scene: SampleScene, moment: SampleMoment): boolean =>
  sampleMoments.indexOf(scene.moment) >= sampleMoments.indexOf(moment);

export const AUTUMN = 'autumn-open';
export const WINTER = 'winter-classic';
export const SCRIMMAGE = 'friday-scrimmage';
export const CHAMPIONSHIP = 'championship';
export const LEAGUE = 'southeast';
export const VARSITY = 'varsity-debate';
export const LEAGUE_NAME = 'Southeast League';

/** The canvas draws one event of three in depth; the others have no reads yet. */
export const varsitySwitch = {
  current: 'Varsity debate',
  position: '1 of 3 events',
  others: ['Novice debate', 'Impromptu'],
} as const;
