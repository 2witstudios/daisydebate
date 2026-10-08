import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { roundSegments } from './schema/round-segments';

/** Serialize transcript writes and AI claims on the owning segment. */
export const lockUtteranceSegment = async (
  tx: Pick<BunSQLDatabase, 'select'>,
  input: { readonly roundId: string; readonly segmentId: string },
) => {
  const [segment] = await tx
    .select({ endedAt: roundSegments.endedAt, type: roundSegments.type })
    .from(roundSegments)
    .where(
      and(
        eq(roundSegments.id, input.segmentId),
        eq(roundSegments.roundId, input.roundId),
      ),
    )
    .for('update');
  return segment;
};
