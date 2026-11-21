import { overRoundStatuses } from '@daisy/protocol';
import { lifecycleSqlList } from '../lifecycle-sql';
import { sql } from 'drizzle-orm';
import { contextChannelRetention } from './context-channel-retention';
import type { Tx } from '../tx';

/** Terminal-end cutoff, supplied as now minus the fixed 180-day floor window. Counters survive. */
export function roundFloorRetention(database: Tx) {
  const purge = contextChannelRetention(
    database,
    'round_floor',
    (before) =>
      sql`join rounds r on r.id=c.round_id where r.status in ${lifecycleSqlList(overRoundStatuses)} and r.completed_at<=${before}::timestamptz`,
  );
  return {
    purgeExpiredRoundFloorMessages: purge.purgeMessages,
    purgeExpiredRoundFloorReceipts: purge.purgeReceipts,
    purgeExpiredRoundFloorReadStates: purge.purgeReadStates,
  };
}
