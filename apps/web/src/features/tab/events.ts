import type { Choice, TabAction } from './action';
import { sampleEventsSchedule } from './sample/events';
import type { SampleScene } from './sample/scene';

export type ScheduledEvent = {
  readonly slug: string;
  readonly name: string;
  readonly summary: string;
  readonly href: string;
};

/** Events that share time slots, and so run together. */
export type EventGroup = {
  readonly name: string;
  readonly times: string;
  readonly events: readonly ScheduledEvent[];
};

export type EventForm = {
  readonly slug: string;
  readonly name: string;
  readonly format: { readonly value: string; readonly source: string };
  readonly divisions: Choice;
  readonly novice: { readonly value: string; readonly source: string };
  readonly prelimRounds: Choice;
  readonly openBreak: Choice;
  readonly noviceBreak: Choice;
  readonly doubleQualifier: Choice;
  readonly runsWith: Choice;
  readonly settings: TabAction;
  readonly remove: TabAction;
};

export type EventsSchedule = {
  readonly lede: string;
  readonly actions: readonly TabAction[];
  readonly groups: readonly EventGroup[];
  readonly entryLimit: { readonly rule: string; readonly source: string };
  readonly judgePool: { readonly rule: string; readonly action: TabAction };
  readonly selected: EventForm | null;
};

export const readEventsSchedule = (
  slug: string,
  event: string | null,
  scene: SampleScene,
): EventsSchedule | null => sampleEventsSchedule(slug, event, scene);
