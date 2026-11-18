import { and, eq } from 'drizzle-orm';
import type { PaidHostingTier } from '@daisy/protocol/lobby/hosting-tier';
import { lobbies, tournaments } from '../schema/lobbies';
import { tournamentHostingPurchases } from '../schema/tournament-hosting-purchases';
import { loadAccountHostingFacts, type AccountHostingFacts } from './account-hosting-facts';
import type { TabTransaction } from './tab-transaction';

/**
 * What a hosted tournament's tier is decided from (ADR 0147): the tiers paid
 * for it, who owns it, and the owner's hosting grants. The caller has the
 * lobby in scope; the tournament row is locked so two entry or setting
 * commands on different events of one tournament count against one cap in
 * turn.
 */
export type TournamentHostingFacts = {
  readonly lobbyId: string;
  readonly ownerUserId: string | null;
  readonly ownerOrganizationId: string | null;
  readonly paidTiers: readonly PaidHostingTier[];
  readonly ownerHosting: AccountHostingFacts | null;
};

export const loadTournamentHostingFacts = async (
  tx: TabTransaction,
  lobbyId: string,
): Promise<TournamentHostingFacts | null> => {
  const [tournament] = await tx
    .select({
      lobbyId: tournaments.lobbyId,
      ownerUserId: lobbies.ownerUserId,
      ownerOrganizationId: lobbies.ownerOrganizationId,
    })
    .from(tournaments)
    .innerJoin(lobbies, eq(lobbies.id, tournaments.lobbyId))
    .where(eq(tournaments.lobbyId, lobbyId))
    .for('update', { of: tournaments });
  if (!tournament) return null;
  const paid = await tx
    .select({ tier: tournamentHostingPurchases.tier })
    .from(tournamentHostingPurchases)
    .where(
      and(
        eq(tournamentHostingPurchases.lobbyId, lobbyId),
        eq(tournamentHostingPurchases.state, 'paid'),
      ),
    );
  return {
    lobbyId,
    ownerUserId: tournament.ownerUserId,
    ownerOrganizationId: tournament.ownerOrganizationId,
    paidTiers: paid.map((row) => row.tier),
    ownerHosting: tournament.ownerUserId
      ? await loadAccountHostingFacts(tx, tournament.ownerUserId)
      : null,
  };
};
