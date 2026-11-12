import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { contextChannelRetention } from './context-channel-retention';

/** Terminal-end cutoff, supplied as now minus the fixed 180-day floor window. Counters survive. */
export function roundFloorRetention(database: Pick<BunSQLDatabase, 'execute'>) {
  const purge = contextChannelRetention(
    database,
    'round_floor',
    (before) =>
      sql`join rounds r on r.id=c.round_id where r.status in ('completed','abandoned') and r.completed_at<=${before}::timestamptz`,
  );
  return {
    purgeExpiredRoundFloorMessages: purge.purgeMessages,
    purgeExpiredRoundFloorReceipts: purge.purgeReceipts,
    purgeExpiredRoundFloorReadStates: purge.purgeReadStates,
  };
}
