import { sql } from 'drizzle-orm';
import { contextChannelModeration } from './context-channel-moderation';
import {
  fenceRoomCommunity,
  readRoomCommunityFact,
} from './room-community-facts';

/**
 * Named internal port. A reported message stays readable to an operator after
 * the Room ends, until its rows are due to be purged.
 */
export const roomCommunityModeration = contextChannelModeration({
  kind: 'room_community',
  ownerColumn: sql`c.room_id`,
  subjectReadable: sql`exists(select 1 from rooms r where r.id=c.room_id and (r.status in ('assembling','ready') or clock_timestamp()<r.updated_at+interval '180 days'))`,
  fence: fenceRoomCommunity,
  readFact: readRoomCommunityFact,
});
