import { sql } from 'drizzle-orm';
import { createContextChannelCohortAuthority } from './context-channel-observation';
import {
  fenceRoomCommunity,
  readRoomCommunityFacts,
} from './room-community-facts';
import type { TxSource } from '../tx';
import { query } from '../raw-rows';
import { z } from 'zod';

/** Named Room chat adopter of the existing channel-messages observation resource. */
export function createRoomCommunityChannelCohortAuthority(database: TxSource) {
  return createContextChannelCohortAuthority(database, {
    ownerOf: async (tx, channelId) => {
      const [row] = await query(
        tx,
        z.object({ room_id: z.string() }),
        sql`select room_id from public.daisy_room_community_channel(${channelId}::text)`,
      );
      return typeof row?.room_id === 'string' ? row.room_id : null;
    },
    fence: fenceRoomCommunity,
    fenceChannel: async (tx, channelId) => {
      const [locked] = await query(
        tx,
        z.object({ locked: z.boolean() }),
        sql`select public.daisy_room_community_channel_read_fence(${channelId}::text) as locked`,
      );
      return locked?.locked === true;
    },
    readFacts: readRoomCommunityFacts,
  });
}
