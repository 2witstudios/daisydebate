import { sql } from 'drizzle-orm';
import {
  withLinkedAdultAudience,
  type RoundFloorFact,
} from '@daisy/protocol/round-floor';
import { type YouthLiveFact, roundStatusSchema } from '@daisy/protocol';
import { postgresInt8, query } from '../raw-rows';
import type { Tx } from '../tx';
import { z } from 'zod';

type FloorRow = {
  readonly actor_id: string;
  readonly version: z.output<typeof postgresInt8>;
  readonly status: RoundFloorFact['status'];
  readonly completed_at: Date | null;
  readonly audience: RoundFloorFact['audience'];
  readonly channel_id: string | null;
  readonly authority_revision: z.output<typeof postgresInt8> | null;
};
/** A Youth Round's linked adults (ADR 0155), as the boundary read them; null on any other Round. */
export type FloorYouth = YouthLiveFact | null;
const factOf = (roundId: string, row: FloorRow): RoundFloorFact => ({
  kind: 'round_floor',
  roundId,
  channelId: row.channel_id,
  policyKey: 'round.floor',
  policyRevision: 1,
  revision: Number(row.version) + Number(row.authority_revision ?? 0),
  status: row.status,
  completedAt:
    row.completed_at === null ? null : new Date(row.completed_at).toISOString(),
  actorId: row.actor_id,
  audience: row.audience,
});

/**
 * Only requested callers' audience categories cross the boundary, in one
 * cohort statement. A Youth Round's linked adult is named only when the Round
 * seats them nowhere: a judge keeps their seat's view (ADR 0155).
 */
export async function readRoundFloorFacts(
  tx: Tx,
  roundId: string,
  actorIds: readonly string[],
  youth: FloorYouth = null,
): Promise<ReadonlyMap<string, RoundFloorFact>> {
  if (actorIds.length === 0) return new Map();
  const rows = await query(
    tx,
    z.object({
      actor_id: z.string(),
      version: postgresInt8,
      status: roundStatusSchema,
      completed_at: z.date().nullable(),
      audience: z.enum(['debater', 'host', 'linked_adult']).nullable(),
      channel_id: z.string().nullable(),
      authority_revision: postgresInt8.nullable(),
    }),
    sql`select wanted.actor_id,f.* from unnest(array[${sql.join(
      actorIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::text[]) as wanted(actor_id) cross join lateral public.daisy_round_floor_fact(${roundId}::text,wanted.actor_id) f`,
  );
  const seated =
    youth === null
      ? new Set<string>()
      : new Set(
          (
            await query(
              tx,
              z.object({ actor_id: z.string() }),
              sql`select p.actor_id from round_participants p where p.round_id=${roundId}::text and public.daisy_round_participant_is_current(p.id)`,
            )
          ).map((row) => row.actor_id),
        );
  return new Map(
    rows.map((row) => {
      const fact = factOf(roundId, row);
      return [
        row.actor_id,
        seated.has(row.actor_id) ? fact : withLinkedAdultAudience(fact, youth),
      ];
    }),
  );
}
export async function readRoundFloorFact(
  tx: Tx,
  roundId: string,
  actorId: string,
  youth: FloorYouth = null,
): Promise<RoundFloorFact | null> {
  return (
    (await readRoundFloorFacts(tx, roundId, [actorId], youth)).get(actorId) ??
    null
  );
}

/** Account -> Round -> channel -> stream is the floor's global lock order. */
export async function fenceRoundFloor(tx: Tx, roundId: string) {
  const [row] = await query(
    tx,
    z.object({ locked: z.boolean() }),
    sql`select public.daisy_round_floor_read_fence(${roundId}::text) as locked`,
  );
  return row?.locked === true;
}
