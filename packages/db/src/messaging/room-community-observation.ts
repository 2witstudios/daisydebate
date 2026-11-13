import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createContextChannelCohortAuthority } from './context-channel-observation';
import {
  fenceRoomCommunity,
  readRoomCommunityFacts,
} from './room-community-facts';

/** Named Room chat adopter of the existing channel-messages observation resource. */
export function createRoomCommunityChannelCohortAuthority(
  database: BunSQLDatabase,
) {
  return createContextChannelCohortAuthority(database, {
    ownerOf: async (tx, channelId) => {
      const [row] = await tx.execute(
        sql`select room_id from public.daisy_room_community_channel(${channelId}::text)`,
      );
      return typeof row?.room_id === 'string' ? row.room_id : null;
    },
    fence: fenceRoomCommunity,
    fenceChannel: async (tx, channelId) => {
      const [locked] = await tx.execute(
        sql`select public.daisy_room_community_channel_read_fence(${channelId}::text) as locked`,
      );
      return locked?.locked === true;
    },
    readFacts: readRoomCommunityFacts,
  });
}
