import { sampleEventsSchedule } from './events';
import type { SampleScene } from './scene';
import { type EventsSchedule, eventsScheduleOf } from '../events';

export const readEventsSchedule = (
  slug: string,
  event: string | null,
  scene: SampleScene,
): EventsSchedule | null => {
  const sample = sampleEventsSchedule(slug, scene);
  return sample === null
    ? null
    : eventsScheduleOf(sample.setup, event, sample.copy);
};
