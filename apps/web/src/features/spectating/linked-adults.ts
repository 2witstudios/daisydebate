import { linkedAdultsFor, type LinkedAdults } from '@daisy/db/youth-live';
import type { YouthLiveFact } from '@daisy/auth/live-audience';
import type { Database } from '@daisy/db';
import { isAppError } from '@daisy/errors';

/** A Round's linked adults for its live audience; null on any Round that is not a Youth one. */
export type LinkedAdultsOf = LinkedAdults;

/** No Round has linked adults: for a read that never admits them. */
export const noLinkedAdults: LinkedAdultsOf = Object.assign(async () => null, {
  peek: () => null,
});

/**
 * One per app's database (ADR 0155): whether a Round is a Youth one, read
 * once, then its youth debaters' linked adults through the one 15-second
 * people cache this database's reads share with the Recording's audience
 * (ADR 0150), on the same fenced read. A revoked grant stops admitting a
 * watcher within that window.
 */
export const liveLinkedAdults = (app: {
  readonly database: Pick<
    Database,
    'readRoundYouth' | 'readYouthRecordingPeople'
  >;
}): LinkedAdultsOf => linkedAdultsFor(app.database);

/**
 * A read a Youth Round's linked adult passes only with that Round's linked
 * adults (ADR 0155). A watcher the cache already names reads once, with them.
 * Anyone else reads without them first, since nobody else needs them; only a
 * refusal reads them, through the cache, and runs once more when they name
 * this caller. Every other refusal stands as it was.
 */
export const withLinkedAdults = async <T>(
  caller: { readonly actorId: string },
  roundId: string,
  linkedAdults: LinkedAdultsOf,
  read: (youth: YouthLiveFact | null) => Promise<T>,
): Promise<T> => {
  const known = linkedAdults.peek(roundId);
  if (known?.linkedAdultActorIds.includes(caller.actorId)) return read(known);
  try {
    return await read(null);
  } catch (error) {
    if (!isAppError(error) || error.code !== 'NOT_FOUND') throw error;
    const youth = await linkedAdults(roundId);
    if (!youth?.linkedAdultActorIds.includes(caller.actorId)) throw error;
    return read(youth);
  }
};
