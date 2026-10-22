import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { rounds } from './schema/rounds';
import { roundSegments } from './schema/round-segments';
import { roundSpeakingIntervals } from './schema/round-speaking-intervals';

/** Historical capture evidence survives segment/Round closure; publication must fence cutoff/freeze separately. */
export const roundSpeakingRead = ({
  database,
}: {
  readonly database: BunSQLDatabase;
}) => ({
  async readRoundSpeakingEligibility(input: {
    readonly roundId: string;
    readonly segmentId: string;
    readonly roundParticipantId: string;
    readonly expectedVersion: number;
    readonly before: string;
    readonly after: string;
  }): Promise<{ readonly eligible: boolean; readonly version: number }> {
    const before = Date.parse(input.before),
      after = Date.parse(input.after);
    if (
      ![input.roundId, input.segmentId, input.roundParticipantId].every(
        (id) => idSchema.safeParse(id).success,
      ) ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !Number.isFinite(before) ||
      !Number.isFinite(after) ||
      before >= after
    )
      throw createAppError('VALIDATION');
    return database.transaction(async (tx) => {
      const [round] = await tx
        .select({ version: rounds.version })
        .from(rounds)
        .where(eq(rounds.id, input.roundId))
        .for('share');
      if (!round) throw createAppError('NOT_FOUND');
      if (round.version !== input.expectedVersion)
        throw createAppError('CONFLICT', 'stale-version');
      const matches = await tx
        .select({ id: roundSpeakingIntervals.id })
        .from(roundSpeakingIntervals)
        .innerJoin(
          roundSegments,
          and(
            eq(roundSegments.id, roundSpeakingIntervals.segmentId),
            eq(roundSegments.roundId, roundSpeakingIntervals.roundId),
          ),
        )
        .where(
          and(
            eq(roundSpeakingIntervals.roundId, input.roundId),
            eq(roundSpeakingIntervals.segmentId, input.segmentId),
            eq(
              roundSpeakingIntervals.roundParticipantId,
              input.roundParticipantId,
            ),
            sql`${roundSpeakingIntervals.startedAt} <= ${new Date(before)}`,
            sql`(${roundSpeakingIntervals.endedAt} is null or ${roundSpeakingIntervals.endedAt} > ${new Date(after)})`,
            sql`${roundSegments.startedAt} <= ${new Date(before)}`,
            sql`${new Date(after)} < least(coalesce(${roundSegments.endedAt}, 'infinity'::timestamptz), ${roundSegments.startedAt} + ${roundSegments.durationMs} * interval '1 millisecond')`,
          ),
        )
        .limit(1);
      return { eligible: matches.length === 1, version: round.version };
    });
  },
});
