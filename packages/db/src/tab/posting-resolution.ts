import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { tabRounds } from '../schema/events';
import type { TabTransaction } from './tab-transaction';

/** The first posting opening releases the existing pin in the same transaction. */
export async function releasePostingResolution(
  tx: TabTransaction,
  input: {
    readonly lobbyId: string;
    readonly eventId: string;
    readonly tabRoundId: string;
    readonly openedAt: string;
  },
) {
  const openedAt = new Date(input.openedAt);
  await tx
    .update(tabRounds)
    .set({
      resolutionReleasedAt: openedAt,
      updatedAt: openedAt,
      version: sql`${tabRounds.version} + 1`,
    })
    .where(
      and(
        eq(tabRounds.id, input.tabRoundId),
        eq(tabRounds.lobbyId, input.lobbyId),
        eq(tabRounds.eventId, input.eventId),
        isNotNull(tabRounds.poolResolutionId),
        isNull(tabRounds.resolutionReleasedAt),
      ),
    );
}
