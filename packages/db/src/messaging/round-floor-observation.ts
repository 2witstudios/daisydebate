import { sql } from 'drizzle-orm';
import { createContextChannelCohortAuthority } from './context-channel-observation';
import {
  readRoundFloorFacts,
  fenceRoundFloor,
  type FloorYouth,
} from './round-floor-facts';
import type { Tx, TxSource } from '../tx';

const floorRoundOf = async (tx: Tx, channelId: string) => {
  const [row] = await tx.execute(
    sql`select round_id from public.daisy_round_floor_channel(${channelId}::text)`,
  );
  return typeof row?.round_id === 'string' ? row.round_id : null;
};

/**
 * Named floor adopter of the existing channel-messages observation resource.
 * A call may carry its Round's linked adults (ADR 0155), which the caller read
 * through its cache before this transaction opened.
 */
export function createRoundFloorChannelCohortAuthority(database: TxSource) {
  const cohortWith = (youth: FloorYouth) =>
    createContextChannelCohortAuthority(database, {
      ownerOf: floorRoundOf,
      fence: fenceRoundFloor,
      fenceChannel: async (tx, channelId) => {
        const [locked] = await tx.execute(
          sql`select public.daisy_round_floor_channel_read_fence(${channelId}::text) as locked`,
        );
        return locked?.locked === true;
      },
      readFacts: (tx, roundId, actorIds) =>
        readRoundFloorFacts(tx, roundId, actorIds, youth),
    });
  type Cohort = ReturnType<typeof cohortWith>;
  return <T>(
    input: Parameters<Cohort>[0] & { readonly youth?: FloorYouth },
    work: (frame: Parameters<Parameters<Cohort>[1]>[0]) => Promise<T>,
  ): Promise<T> => cohortWith(input.youth ?? null)(input, work);
}
