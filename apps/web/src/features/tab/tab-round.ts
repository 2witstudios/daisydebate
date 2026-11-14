import type { TabAction } from './action';
import { sampleRunningRound, sampleTimeSlot } from './sample/tab-round';
import type { SampleScene } from './sample/scene';
import type { EventSwitch } from './setup';

/** How much of the host's attention a Room wants, most first. */
export type RoomAttention =
  'needs_you' | 'waiting' | 'live' | 'judging' | 'finished';

export type AttentionRoom = {
  readonly title: string;
  readonly detail: string;
  readonly action: TabAction;
};

export type AttentionGroup = {
  readonly attention: RoomAttention;
  /** How many Rooms stand here, when the list shows only some of them. */
  readonly count: number | null;
  readonly rooms: readonly AttentionRoom[];
  readonly more: TabAction | null;
};

/** One published tab round of one event, with its Rooms by attention. */
export type RunningRound = {
  readonly event: EventSwitch;
  readonly title: string;
  readonly lede: string;
  readonly participantView: TabAction;
  readonly next: TabAction | null;
  readonly groups: readonly AttentionGroup[];
};

export type SlotEvent = {
  readonly slug: string;
  readonly name: string;
  readonly note: string | null;
  readonly detail: string;
  readonly rooms: TabAction;
};

/** One time slot across every event that shares it. */
export type TimeSlot = {
  readonly title: string;
  readonly lede: string;
  readonly participantView: TabAction;
  readonly tabs: readonly {
    readonly id: string;
    readonly label: string;
    readonly href: string;
    readonly selected: boolean;
  }[];
  readonly needsYou: readonly AttentionRoom[];
  readonly events: readonly SlotEvent[];
  readonly next: {
    readonly heading: string;
    readonly items: readonly AttentionRoom[];
  } | null;
};

export const readRunningRound = (
  slug: string,
  event: string,
  round: string,
  scene: SampleScene,
): RunningRound | null => sampleRunningRound(slug, event, round, scene);

export const readTimeSlot = (
  slug: string,
  slot: string,
  event: string | null,
  scene: SampleScene,
): TimeSlot | null => sampleTimeSlot(slug, slot, event, scene);
