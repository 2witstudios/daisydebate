import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { contextChannelRetention } from './context-channel-retention';

/**
 * Cutoff supplied as now minus the fixed 180-day Room chat window, measured
 * from the Room's end: no write moves `updated_at` once a Room has started or
 * closed (ADR 0126), so it is that end. Counters survive. The ended statuses
 * are a SQL spelling of `!isOpenRoomStatus` (ISSUE-1395).
 */
export function roomCommunityRetention(
  database: Pick<BunSQLDatabase, 'execute'>,
) {
  const purge = contextChannelRetention(
    database,
    'room_community',
    (before) =>
      sql`join rooms r on r.id=c.room_id where r.status in ('started','closed') and r.updated_at<=${before}::timestamptz`,
  );
  return {
    purgeExpiredRoomCommunityMessages: purge.purgeMessages,
    purgeExpiredRoomCommunityReceipts: purge.purgeReceipts,
    purgeExpiredRoomCommunityReadStates: purge.purgeReadStates,
  };
}
