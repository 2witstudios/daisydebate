import { createRefusal } from '@daisy/errors';
import { roundRatingScopeSchema, type RoundRatingScope } from '@daisy/protocol';
import { and, asc, eq } from 'drizzle-orm';
import { ladders } from './schema/ladders';
import { lobbies } from './schema/lobbies';
import { seasons } from './schema/seasons';
import { currentTenantScope, scopeTransaction } from './tenant-scope';
import type { LobbyRatingSelection } from './standings';
import type { Tx } from './tx';

const roomLadderOrder = [asc(ladders.createdAt), asc(ladders.id)] as const;

/** Share Room pool precedence and reuse the fallback across a lobby's discovery page. */
export function roomRatingPoolReader(tx: Pick<Tx, 'select'>, lobbyId: string) {
  let primary: Promise<string | undefined> | undefined;
  return async (
    selectedLadderId: string | null,
    frozen?: {
      readonly ladderId: string | null;
      readonly seasonId: string | null;
    },
  ): Promise<LobbyRatingSelection | null> => {
    const ladderId =
      frozen?.ladderId ??
      selectedLadderId ??
      (await (primary ??= tx
        .select({ id: ladders.id })
        .from(ladders)
        .where(eq(ladders.lobbyId, lobbyId))
        .orderBy(...roomLadderOrder)
        .limit(1)
        .then(([row]) => row?.id)));
    return ladderId
      ? {
          lobbyId,
          ladderId,
          ...(frozen?.seasonId ? { seasonId: frozen.seasonId } : {}),
        }
      : null;
  };
}

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
  tx: Pick<Tx, 'select' | 'execute'>,
  lobbyId: string,
  selectedLadderId?: string,
): Promise<NonNullable<RoundRatingScope>> {
  const [lobby] = await tx
    .select({ organizationId: lobbies.ownerOrganizationId })
    .from(lobbies)
    .where(and(eq(lobbies.id, lobbyId), eq(lobbies.kind, 'standing')));
  if (!lobby?.organizationId)
    throw createRefusal('CONFLICT', 'ranked-unavailable');
  // A ladder is openly readable, but PostgreSQL applies its tenant write
  // policy to row locks too. The scope comes from the persisted Room lobby.
  const priorScope = await currentTenantScope(tx);
  await scopeTransaction(tx, {
    ...priorScope,
    lobbyId,
    organizationId: lobby.organizationId,
  });
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
    .orderBy(...roomLadderOrder)
    .limit(1)
    .for('share', { of: [seasons, ladders] });
  await scopeTransaction(tx, priorScope);
  if (!pool) throw createRefusal('CONFLICT', 'ranked-unavailable');
  return roundRatingScopeSchema.unwrap().parse(pool);
}
