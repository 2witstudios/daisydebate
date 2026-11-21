import { sampleEntryList, sampleJudgeList } from './entries';
import { varsitySwitch } from './event-switch';
import type { SampleScene } from './scene';
import {
  type HostEntries,
  type HostJudges,
  hostEntriesOf,
  hostJudgesOf,
} from '../../entries';

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
