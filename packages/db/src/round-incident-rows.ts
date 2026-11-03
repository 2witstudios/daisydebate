import type { RoundIncidentChange } from '@daisy/protocol';
import { and, eq, isNull } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { refundPlatformEndedLocked } from './round-bot-admission';
import { roundIncidents } from './schema/round-incidents';
import { rounds } from './schema/rounds';

type Tx = Pick<BunSQLDatabase, 'select' | 'update' | 'insert' | 'execute'>;

/**
 * The one writer of an incident's row, recording what the engine said happened in the
 * revision it commits with. An ending also sets the Round's platform ending and refunds.
 */
export async function writeRoundIncidentChanges(
  tx: Tx,
  roundId: string,
  changes: readonly RoundIncidentChange[],
) {
  for (const change of changes) {
    if (change.kind === 'opened') {
      await tx.insert(roundIncidents).values({
        id: change.id,
        roundId,
        cause: change.cause,
        detectedAt: new Date(change.since),
        resumePoint:
          change.resumePoint === null ? null : new Date(change.resumePoint),
      });
      continue;
    }
    // At most one incident is open per Round, and only that one can change.
    const thisIncident = and(
      eq(roundIncidents.roundId, roundId),
      isNull(roundIncidents.resumedAt),
      isNull(roundIncidents.endedAt),
    );
    if (change.kind === 'resumed') {
      await tx
        .update(roundIncidents)
        .set({ resumedAt: new Date(change.at), returnedMs: change.returnedMs })
        .where(thisIncident);
      continue;
    }
    await tx
      .update(roundIncidents)
      .set({ endedAt: new Date(change.at) })
      .where(thisIncident);
    await tx
      .update(rounds)
      .set({ platformEnding: 'recovery_bound' })
      .where(eq(rounds.id, roundId));
    await refundPlatformEndedLocked(tx, roundId);
  }
}
