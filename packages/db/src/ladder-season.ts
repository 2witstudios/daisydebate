import { createRefusal } from '@daisy/errors';
import { roundRatingScopeSchema, type RoundRatingScope } from '@daisy/protocol';
import { and, asc, eq } from 'drizzle-orm';
import { ladders } from './schema/ladders';
import { seasons } from './schema/seasons';
import type { Tx } from './tx';

/** Hold the season through the write that relies on it. */
export async function lockActiveLobbySeason(
  tx: Pick<Tx, 'select'>,
  lobbyId: string,
): Promise<string | null> {
  const [season] = await tx
    .select({ id: seasons.id })
    .from(seasons)
    .where(and(eq(seasons.lobbyId, lobbyId), eq(seasons.status, 'active')))
    .for('share');
  return season?.id ?? null;
}

/** The lobby's own selected ladder and active season, held through Start. */
export async function lockLadderSeason(
  tx: Pick<Tx, 'select'>,
  lobbyId: string,
  selectedLadderId?: string,
): Promise<NonNullable<RoundRatingScope>> {
  const [pool] = await tx
    .select({
      lobbyId: ladders.lobbyId,
      ladderId: ladders.id,
      seasonId: seasons.id,
    })
    .from(seasons)
    .innerJoin(ladders, eq(ladders.lobbyId, seasons.lobbyId))
    .where(
      and(
        eq(seasons.lobbyId, lobbyId),
        eq(seasons.status, 'active'),
        selectedLadderId === undefined
          ? undefined
          : eq(ladders.id, selectedLadderId),
      ),
    )
    .orderBy(asc(ladders.createdAt), asc(ladders.id))
    .limit(1)
    .for('share', { of: [seasons, ladders] });
  if (!pool) throw createRefusal('CONFLICT', 'ranked-unavailable');
  return roundRatingScopeSchema.unwrap().parse(pool);
}
