import { sql } from 'drizzle-orm';
import type { RoundFloorFact } from '@daisy/protocol/round-floor';
import type { AuthorizationTransaction } from '../authorization';
import { rowsOf } from '../raw-rows';

type FloorRow = {
  readonly actor_id: string;
  readonly version: number;
  readonly status: RoundFloorFact['status'];
  readonly completed_at: Date | null;
  readonly audience: RoundFloorFact['audience'];
  readonly channel_id: string | null;
  readonly authority_revision: number | null;
};
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

/** Only requested callers' audience categories cross the boundary, in one cohort statement. */
export async function readRoundFloorFacts(
  tx: AuthorizationTransaction,
  roundId: string,
  actorIds: readonly string[],
): Promise<ReadonlyMap<string, RoundFloorFact>> {
  if (actorIds.length === 0) return new Map();
  const rows = await rowsOf<FloorRow>(
    tx,
    sql`select wanted.actor_id,f.* from unnest(array[${sql.join(
      actorIds.map((id) => sql`${id}`),
      sql`, `,
    )}]::text[]) as wanted(actor_id) cross join lateral public.daisy_round_floor_fact(${roundId}::text,wanted.actor_id) f`,
  );
  return new Map(rows.map((row) => [row.actor_id, factOf(roundId, row)]));
}
export async function readRoundFloorFact(
  tx: AuthorizationTransaction,
  roundId: string,
  actorId: string,
): Promise<RoundFloorFact | null> {
  return (
    (await readRoundFloorFacts(tx, roundId, [actorId])).get(actorId) ?? null
  );
}

/** Account -> Round -> channel -> stream is the floor's global lock order. */
export async function fenceRoundFloor(
  tx: AuthorizationTransaction,
  roundId: string,
) {
  const [row] = await tx.execute(
    sql`select public.daisy_round_floor_read_fence(${roundId}::text) as locked`,
  );
  return row?.locked === true;
}
