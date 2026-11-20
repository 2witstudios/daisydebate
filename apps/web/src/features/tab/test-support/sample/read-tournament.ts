import { sampleTimelineRead } from './rail';
import { sampleAddressOf } from './tournament';
import type { SampleScene } from './scene';
import { type TimelineRail, timelineRailOf } from '../../tournament';

export const readTimelineRail = (
  slug: string,
  scene: SampleScene,
): TimelineRail | null => {
  const lobby = sampleTimelineRead(slug, scene);
  return lobby === null ? null : timelineRailOf(lobby, sampleAddressOf);
};
