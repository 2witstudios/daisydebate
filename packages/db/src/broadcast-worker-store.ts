import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import {
  claimBroadcast,
  completeBroadcast,
  recordHoldAdvanced,
  recordMediaEndReleased,
  recordSegmentReleased,
  renewBroadcastLease,
} from './broadcast-operations';

/**
 * The hold worker's one database credential: broadcasts only. It cannot read a
 * Round, so nothing it does can reach the debate (ADR 0099).
 */
export const createBroadcastWorkerStore = (url: string) => {
  const client = new SQL(url, { max: 2 });
  const database = drizzle({ client });
  return {
    claim: (input: Parameters<typeof claimBroadcast>[1]) =>
      database.transaction((tx) => claimBroadcast(tx, input)),
    recordReleased: (input: Parameters<typeof recordSegmentReleased>[1]) =>
      recordSegmentReleased(database, input),
    recordAdvanced: (input: Parameters<typeof recordHoldAdvanced>[1]) =>
      recordHoldAdvanced(database, input),
    recordEnded: (input: Parameters<typeof recordMediaEndReleased>[1]) =>
      recordMediaEndReleased(database, input),
    renew: (input: Parameters<typeof renewBroadcastLease>[1]) =>
      renewBroadcastLease(database, input),
    complete: (input: Parameters<typeof completeBroadcast>[1]) =>
      completeBroadcast(database, input),
    close: () => client.close(),
  };
};
