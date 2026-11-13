import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createContextChannelCohortAuthority } from './context-channel-observation';
import { readRoundFloorFacts, fenceRoundFloor } from './round-floor-facts';

/** Named floor adopter of the existing channel-messages observation resource. */
export function createRoundFloorChannelCohortAuthority(
  database: BunSQLDatabase,
) {
  return createContextChannelCohortAuthority(database, {
    ownerOf: async (tx, channelId) => {
      const [row] = await tx.execute(
        sql`select round_id from public.daisy_round_floor_channel(${channelId}::text)`,
      );
      return typeof row?.round_id === 'string' ? row.round_id : null;
    },
    fence: fenceRoundFloor,
    fenceChannel: async (tx, channelId) => {
      const [locked] = await tx.execute(
        sql`select public.daisy_round_floor_channel_read_fence(${channelId}::text) as locked`,
      );
      return locked?.locked === true;
    },
    readFacts: readRoundFloorFacts,
  });
}
