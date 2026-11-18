import {
  sampleEntryList,
  sampleJudgeList,
  sampleSchoolEntries,
} from './entries';
import { varsitySwitch } from './event-switch';
import type { SampleScene } from './scene';
import {
  type HostEntries,
  type HostJudges,
  type SchoolEntries,
  hostEntriesOf,
  hostJudgesOf,
  schoolEntriesOf,
} from '../entries';

export const readHostEntries = (
  slug: string,
  scene: SampleScene,
): HostEntries | null => {
  const view = sampleEntryList(slug, scene);
  return view === null ? null : hostEntriesOf(view, varsitySwitch(scene));
};

export const readHostJudges = (
  slug: string,
  scene: SampleScene,
): HostJudges | null => {
  const view = sampleJudgeList(slug, scene);
  return view === null ? null : hostJudgesOf(view);
};

export const readSchoolEntries = (
  slug: string,
  scene: SampleScene,
): SchoolEntries | null => {
  const view = sampleSchoolEntries(slug, scene);
  return view === null ? null : schoolEntriesOf(view, slug);
};
