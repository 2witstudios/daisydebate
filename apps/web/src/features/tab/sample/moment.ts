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
export const IMPROMPTU = 'impromptu';
export const LEAGUE_NAME = 'Southeast League';

/** The rounds a participant has a posting for: the one running and the next. */
export const postedRounds: readonly string[] = ['3', '4'];
