import type { readYouthRoundPeople } from './youth-recording-people';
import { youthPeopleCache, type YouthPeopleCache } from './youth-people-cache';
import {
  youthRoundLinkedAdults,
  type LinkedAdults,
} from './youth-round-linked-adults';

/**
 * A Youth Round's linked adults for its live audience and its Recording
 * (ADR 0150, ADR 0155): one 15-second people cache and one resolver over it
 * per set of reads, so the web's Recording playback and live watchers share
 * a cache, and the realtime server keeps its own on its own lanes.
 */
export { YOUTH_PEOPLE_TTL_MS, youthPeopleCache } from './youth-people-cache';
export { youthRoundLinkedAdults } from './youth-round-linked-adults';
export type { LinkedAdults } from './youth-round-linked-adults';
export type { YouthPeopleCache } from './youth-people-cache';

/** The reads a Youth Round's people and its division come from. */
export type YouthLiveReads = {
  readonly readRoundYouth: (roundId: string) => Promise<boolean | null>;
  readonly readYouthRoundPeople: (
    roundId: string,
  ) => ReturnType<typeof readYouthRoundPeople>;
};

const peopleOf = new WeakMap<YouthLiveReads, YouthPeopleCache>();
const linkedOf = new WeakMap<YouthLiveReads, LinkedAdults>();

/** The one people cache for these reads. Monotonic: a wall clock stepping back must not stretch it. */
export const youthPeopleFor = (reads: YouthLiveReads): YouthPeopleCache => {
  const known = peopleOf.get(reads);
  if (known) return known;
  const made = youthPeopleCache({
    read: reads.readYouthRoundPeople,
    nowMs: () => performance.now(),
  });
  peopleOf.set(reads, made);
  return made;
};

/** The one linked-adults resolver for these reads, over their people cache. */
export const linkedAdultsFor = (reads: YouthLiveReads): LinkedAdults => {
  const known = linkedOf.get(reads);
  if (known) return known;
  const made = youthRoundLinkedAdults({
    readRoundYouth: reads.readRoundYouth,
    people: youthPeopleFor(reads),
  });
  linkedOf.set(reads, made);
  return made;
};
