import { idSchema } from '@daisy/protocol';
import type { RoundFloorFact } from '@daisy/protocol/round-floor';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import {
  readAuthorizationActors,
  type AuthorizationTransaction,
} from '../authorization';
import { readRoundFloorFacts, fenceRoundFloor } from './round-floor-facts';
import { channelObservationReads } from './observation-reads';

/** Named floor adopter of the existing channel-messages observation resource. */
export function createRoundFloorChannelCohortAuthority(
  database: BunSQLDatabase,
) {
  return async <T>(
    input: {
      readonly channelId: string;
      readonly viewers: readonly {
        readonly actorId: string;
        readonly userId: string;
      }[];
    },
    work: (frame: {
      readonly tx: AuthorizationTransaction;
      readonly accounts: Awaited<ReturnType<typeof readAuthorizationActors>>;
      readonly factFor: (actorId: string) => RoundFloorFact;
      readonly contentRevision: number;
    }) => Promise<T>,
  ): Promise<T> => {
    idSchema.parse(input.channelId);
    const actorIds = [
      ...new Set(input.viewers.map((v) => idSchema.parse(v.actorId))),
    ].sort();
    if (actorIds.length === 0 || input.viewers.length > 65535)
      throw createAppError('VALIDATION');
    return database.transaction(async (tx) => {
      const accounts = await readAuthorizationActors(tx, actorIds, {
        maxActors: 65535,
      });
      const [row] = await tx.execute(
        sql`select round_id from public.daisy_round_floor_channel(${input.channelId}::text)`,
      );
      if (
        !row ||
        typeof row.round_id !== 'string' ||
        !(await fenceRoundFloor(tx, row.round_id))
      )
        throw createAppError('NOT_FOUND');
      const [locked] = await tx.execute(
        sql`select public.daisy_round_floor_channel_read_fence(${input.channelId}::text) as locked`,
      );
      if (locked?.locked !== true) throw createAppError('NOT_FOUND');
      const facts = await readRoundFloorFacts(tx, row.round_id, actorIds);
      if (
        actorIds.some(
          (actorId) => facts.get(actorId)?.channelId !== input.channelId,
        )
      )
        throw createAppError('NOT_FOUND');
      const header = (
        await channelObservationReads(tx).readChannelObservationHeaders([
          input.channelId,
        ])
      ).get(input.channelId);
      if (!header) throw createAppError('NOT_FOUND');
      return work({
        tx,
        accounts,
        contentRevision: header.contentRevision,
        factFor: (actorId) => {
          const fact = facts.get(actorId);
          if (!fact) throw createAppError('INVARIANT');
          return fact;
        },
      });
    });
  };
}
