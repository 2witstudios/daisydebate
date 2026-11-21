import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { lobbies } from '../schema/lobbies';
import { scopeTransaction, type TenantScope } from '../tenant-scope';
import type { TabTransaction } from './tab-transaction';

/** Resolve the live rule under the specific tournament's tenant and parent. */
export async function loadTournamentEligibility(
  tx: TabTransaction,
  scope: TenantScope,
  lobby: typeof lobbies.$inferSelect,
) {
  if (lobby.ownerOrganizationId === null && lobby.ageRule !== null)
    return { kind: 'own' as const, lobbyId: lobby.id, ageRule: lobby.ageRule };
  if (lobby.standingLobbyId === null || lobby.ownerOrganizationId === null)
    throw createAppError('INVARIANT', 'Tournament standing lobby is missing');

  await scopeTransaction(tx, { ...scope, lobbyId: lobby.standingLobbyId });
  try {
    const [parent] = await tx
      .select({ id: lobbies.id, name: lobbies.name, ageRule: lobbies.ageRule })
      .from(lobbies)
      .where(
        and(
          eq(lobbies.id, lobby.standingLobbyId),
          eq(lobbies.kind, 'standing'),
          eq(lobbies.ownerOrganizationId, lobby.ownerOrganizationId),
        ),
      )
      .for('share');
    if (!parent || parent.ageRule === null)
      throw createAppError(
        'INVARIANT',
        'Tournament standing lobby has no age rule',
      );
    return {
      kind: 'standing' as const,
      lobbyId: parent.id,
      ageRule: parent.ageRule,
      lobbyName: parent.name,
    };
  } finally {
    await scopeTransaction(tx, scope);
  }
}
