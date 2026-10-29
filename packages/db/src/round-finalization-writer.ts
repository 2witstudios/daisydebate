import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';

/** Caller holds the Round lock and has inserted the accepted terminal command. */
export async function freezeRoundFinalization(
  tx: Pick<BunSQLDatabase, 'execute'>,
  input: {
    readonly roundId: string;
    readonly commandId: string;
    readonly resultingVersion: number;
    readonly freezeRevision: number | null;
    readonly ballotIds: readonly string[];
  },
): Promise<void> {
  const [frozen] = await tx.execute(sql`
    insert into round_finalizations(round_id,command_id,resulting_version,freeze_revision)
    values(${input.roundId},${input.commandId},${input.resultingVersion},${input.freezeRevision})
    returning round_id`);
  if (!frozen) return;
  for (const ballotId of input.ballotIds)
    await tx.execute(sql`insert into round_finalization_ballots(round_id,ballot_id,freeze_revision)
      values(${input.roundId},${ballotId},${input.freezeRevision})`);
}
