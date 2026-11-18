import { and, desc, eq } from 'drizzle-orm';
import { effectiveHostingTier } from '@daisy/protocol/lobby/hosting-tier';
import { tournamentHostingPurchases } from '../schema/tournament-hosting-purchases';
import { lobbies } from '../schema/lobbies';
import { actors } from '../schema/actors';
import { scopeTransaction } from '../tenant-scope';
import { loadAuthorizationAccount } from '../authorization';
import { loadAccountHostingFacts } from './account-hosting-facts';
import { currentTournamentSponsorship } from './tournament-sponsorship';
import type { TabTransaction } from './tab-transaction';

/** Read-only locator before account locks; it grants nothing and must be matched after parent fences. */
export const locateTournamentCaptureFunder = async (
  tx: TabTransaction,
  input: { readonly lobbyId: string; readonly callerUserId: string },
) => {
  await scopeTransaction(tx, {
    subjectUserId: input.callerUserId,
    lobbyId: input.lobbyId,
  });
  const [lobby] = await tx
    .select()
    .from(lobbies)
    .where(eq(lobbies.id, input.lobbyId));
  if (lobby?.kind !== 'tournament' || lobby.closedAt !== null) return null;
  const sponsorship = lobby.ownerOrganizationId
    ? await currentTournamentSponsorship(tx, lobby.id)
    : null;
  const userId =
    lobby.ownerUserId ??
    (sponsorship?.kind === 'active' ? sponsorship.sponsorUserId : null);
  if (!userId) return null;
  const [actor] = await tx
    .select({ id: actors.id })
    .from(actors)
    .where(eq(actors.userId, userId));
  if (!actor) return null;
  return {
    lobbyId: lobby.id,
    userId,
    actorId: actor.id,
    ownerUserId: lobby.ownerUserId,
    ownerOrganizationId: lobby.ownerOrganizationId,
    sponsorship,
  };
};
export type TournamentCaptureFunderLocator = NonNullable<
  Awaited<ReturnType<typeof locateTournamentCaptureFunder>>
>;
export class TournamentCaptureFundingChanged extends Error {}

/** Caller already holds this account and the actual lobby/organization fences. */
export const loadTournamentCaptureFunding = async (
  tx: TabTransaction,
  locator: TournamentCaptureFunderLocator,
  callerUserId: string,
) => {
  const current = await locateTournamentCaptureFunder(tx, {
    lobbyId: locator.lobbyId,
    callerUserId,
  });
  if (
    !current ||
    current.userId !== locator.userId ||
    current.actorId !== locator.actorId ||
    current.ownerUserId !== locator.ownerUserId ||
    current.ownerOrganizationId !== locator.ownerOrganizationId ||
    current.sponsorship?.id !== locator.sponsorship?.id
  )
    throw new TournamentCaptureFundingChanged();
  const account = await loadAuthorizationAccount(tx, current.userId);
  const hosting = await loadAccountHostingFacts(tx, current.userId);
  // A personal tournament paid for funds its own capture (ADR 0147).
  const paidRows =
    current.ownerOrganizationId === null
      ? await tx
          .select({
            id: tournamentHostingPurchases.id,
            lobbyId: tournamentHostingPurchases.lobbyId,
            tier: tournamentHostingPurchases.tier,
            paidAt: tournamentHostingPurchases.paidAt,
          })
          .from(tournamentHostingPurchases)
          .where(
            and(
              eq(tournamentHostingPurchases.lobbyId, current.lobbyId),
              eq(tournamentHostingPurchases.state, 'paid'),
            ),
          )
          .orderBy(desc(tournamentHostingPurchases.paidAt))
      : [];
  // The highest tier by the protocol's own order, its latest payment.
  const highest = effectiveHostingTier({
    paidTiers: paidRows.map((row) => row.tier),
    granted: false,
  });
  const hostingPurchase = paidRows.find((row) => row.tier === highest);
  return {
    ...current,
    account,
    hosting,
    hostingPurchase:
      hostingPurchase && hostingPurchase.paidAt
        ? {
            id: hostingPurchase.id,
            lobbyId: hostingPurchase.lobbyId,
            tier: hostingPurchase.tier,
            paidAt: hostingPurchase.paidAt.toISOString(),
          }
        : null,
  };
};
export type TournamentCaptureFunding = Awaited<
  ReturnType<typeof loadTournamentCaptureFunding>
>;
