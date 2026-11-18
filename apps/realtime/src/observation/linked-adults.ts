import { youthPeopleCache, youthRoundLinkedAdults } from '@daisy/db/youth-live';
import type { RealtimeAuthorityReads } from '@daisy/db';
import type { YouthLiveFact } from '@daisy/auth/live-audience';

type LinkedAdultsOf = (roundId: string) => Promise<YouthLiveFact | null>;
const known = new WeakMap<RealtimeAuthorityReads, LinkedAdultsOf>();

/**
 * A live Youth Round's linked adults (ADR 0155), one resolver per lane's
 * reads: whether the Round is a Youth one, read once, then its youth
 * debaters' coaches and guardians through the same 15-second people cache
 * the web keeps, on the same fenced read. Null on any other Round.
 */
export const linkedAdultsFor = (reads: RealtimeAuthorityReads) => {
  const found = known.get(reads);
  if (found) return found;
  const linked = youthRoundLinkedAdults({
    readRoundYouth: reads.readRoundYouth,
    people: youthPeopleCache({
      read: reads.readYouthRecordingPeople,
      nowMs: () => performance.now(),
    }),
  });
  known.set(reads, linked);
  return linked;
};
