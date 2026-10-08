import { createAppError } from '@daisy/errors';
import { eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { roundParticipants } from './schema/round-participants';
import { rounds } from './schema/rounds';
import { ballots } from './schema/ballots';

/**
 * Ballots are written only by the atomic round-completion operation. This
 * adapter retains ballot reads and voiding for the completed round.
 */
export const ballotOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /**
   * Retirement is voiding, never deletion: the row stays and records who
   * and when, tied to the status by CHECK.
   */
  async voidBallot(input: {
    readonly judgeParticipantId: string;
    readonly voidedByActorId: string;
  }): Promise<{ readonly voided: boolean }> {
    return instrumented(eventSink, 'voidBallot', async () => {
      return database.transaction(async (tx) => {
        const [seat] = await tx
          .select({ roundId: roundParticipants.roundId })
          .from(roundParticipants)
          .where(eq(roundParticipants.id, input.judgeParticipantId));
        if (!seat) throw createAppError('NOT_FOUND', 'No such seat');
        await tx
          .select({ id: rounds.id })
          .from(rounds)
          .where(eq(rounds.id, seat.roundId))
          .for('update');
        const updated = await tx
          .update(ballots)
          .set({
            status: 'voided',
            voidedAt: sql`statement_timestamp()` as unknown as Date,
            voidedByActorId: input.voidedByActorId,
          })
          .where(eq(ballots.judgeParticipantId, input.judgeParticipantId))
          .returning({ id: ballots.id });
        return { voided: updated.length === 1 };
      });
    });
  },

  /** The stored ballot for a judge seat, or null. */
  async getBallot(judgeParticipantId: string) {
    return instrumented(eventSink, 'getBallot', async () => {
      const [row] = await database
        .select()
        .from(ballots)
        .where(eq(ballots.judgeParticipantId, judgeParticipantId))
        .limit(1);
      return row ?? null;
    });
  },
});
