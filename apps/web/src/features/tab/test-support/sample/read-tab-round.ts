import { sampleTabRoundView, sampleTimeSlotView } from './tab-round';
import type { SampleScene } from './scene';
import {
  type RunningRound,
  type TimeSlot,
  runningRoundOf,
  timeSlotOf,
} from '../../tab-round';

export const readRunningRound = (
  slug: string,
  event: string,
  round: string,
  scene: SampleScene,
): RunningRound | null => {
  const sample = sampleTabRoundView(slug, event, round, scene);
  return sample === null ? null : runningRoundOf(sample.read, sample.context);
};

export const readTimeSlot = (
  slug: string,
  slot: string,
  event: string | null,
  scene: SampleScene,
): TimeSlot | null => {
  const sample = sampleTimeSlotView(slug, slot, scene);
  if (sample === null) return null;
  const selectedEventId = sample.eventIdOf(event);
  if (event !== null && selectedEventId === null) return null;
  return timeSlotOf(sample.read, { ...sample.context, selectedEventId });
};
