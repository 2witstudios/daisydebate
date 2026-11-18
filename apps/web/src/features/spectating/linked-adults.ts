import { youthPeopleCache, youthRoundLinkedAdults } from '@daisy/db/youth-live';
import type { YouthLiveFact } from '@daisy/auth/live-audience';
import type { Database } from '@daisy/db';

/** A Round's linked adults for its live audience; null on any Round that is not a Youth one. */
export type LinkedAdultsOf = (roundId: string) => Promise<YouthLiveFact | null>;

/** No Round has linked adults: for a read that never admits them. */
export const noLinkedAdults: LinkedAdultsOf = async () => null;

type LinkedAdultsReads = Pick<
  Database,
  'readRoundYouth' | 'readYouthRecordingPeople'
>;
const linkedAdultsOf = new WeakMap<LinkedAdultsReads, LinkedAdultsOf>();

/**
 * One per app's database (ADR 0155): whether a Round is a Youth one, read once, then its
 * youth debaters' linked adults through the 15-second people cache the
 * Recording's audience uses (ADR 0150), on the same fenced read. A revoked
 * grant stops admitting a watcher within that window.
 */
export const liveLinkedAdults = (app: {
  readonly database: LinkedAdultsReads;
}): LinkedAdultsOf => {
  const known = linkedAdultsOf.get(app.database);
  if (known) return known;
  const linked = youthRoundLinkedAdults({
    readRoundYouth: app.database.readRoundYouth,
    people: youthPeopleCache({
      read: app.database.readYouthRecordingPeople,
      // Monotonic: a wall clock stepping back must not stretch the window.
      nowMs: () => performance.now(),
    }),
  });
  linkedAdultsOf.set(app.database, linked);
  return linked;
};
