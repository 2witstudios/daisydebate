import { varsitySwitch } from './event-switch';
import { sampleResolutionPoolView } from './resolutions';
import type { SampleScene } from './scene';
import { type ResolutionPool, resolutionPoolOf } from '../resolution-pool';

export const readResolutionPool = (
  slug: string,
  event: string,
  scene: SampleScene,
): ResolutionPool | null => {
  const view = sampleResolutionPoolView(slug, event, scene);
  return view === null
    ? null
    : resolutionPoolOf(view, varsitySwitch(scene), slug);
};
