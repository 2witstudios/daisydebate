import {
  sampleHostHomeView,
  sampleHostAddress,
  sampleNow,
  samplePeopleView,
  sampleViewerId,
} from './organization';
import type { TimelineRail } from '../tournament';
import type { SampleScene } from './scene';
import {
  type HostHome,
  type People,
  hostHomeOf,
  hostRailOf,
  peopleOf,
} from '../organization';

export const readHostHome = (scene: SampleScene): HostHome =>
  hostHomeOf(sampleHostHomeView(scene), sampleNow, sampleHostAddress);

export const readPeople = (
  role: string | null,
  basePath: string,
  scene: SampleScene,
): People =>
  peopleOf(samplePeopleView(scene), {
    role,
    basePath,
    viewerId: sampleViewerId,
    now: sampleNow,
  });

export const readHostRail = (scene: SampleScene): TimelineRail =>
  hostRailOf(sampleHostHomeView(scene), sampleNow, sampleHostAddress);
