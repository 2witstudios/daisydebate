import { sql } from 'drizzle-orm';
import { contextChannelModeration } from './context-channel-moderation';
import { readRoundFloorFact, fenceRoundFloor } from './round-floor-facts';

/** Named internal port. Reporting must compose the returned fact with current floor read authority. */
export const roundFloorModeration = contextChannelModeration({
  kind: 'round_floor',
  ownerColumn: sql`c.round_id`,
  subjectReadable: sql`exists(select 1 from rounds r where r.id=c.round_id and (r.completed_at is null or clock_timestamp()<r.completed_at+interval '180 days'))`,
  fence: fenceRoundFloor,
  readFact: readRoundFloorFact,
});
