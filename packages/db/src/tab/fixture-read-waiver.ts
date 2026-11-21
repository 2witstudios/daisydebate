import { and, eq, isNotNull, asc } from 'drizzle-orm';
import { conflicts } from '../schema/conflicts';
import type { Tx } from '../tx';

/** A retained second-person waiver is scoped to this exact account and fixture; current read authority is still required. */
export const readFixtureReadWaiver = async (
  tx: Tx,
  input: {
    readonly lobbyId: string;
    readonly fixtureId: string;
    readonly userId: string;
  },
) => {
  const [waiver] = await tx
    .select({ id: conflicts.id })
    .from(conflicts)
    .where(
      and(
        eq(conflicts.lobbyId, input.lobbyId),
        eq(conflicts.fixtureId, input.fixtureId),
        eq(conflicts.userId, input.userId),
        eq(conflicts.handling, 'second_confirms'),
        isNotNull(conflicts.confirmedByUserId),
      ),
    )
    .orderBy(asc(conflicts.detectedAt), asc(conflicts.id))
    .limit(1);
  return waiver?.id ?? null;
};
