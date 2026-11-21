import type { TabStore } from '@daisy/db/tab';
import { hostingEntryCap } from '@daisy/protocol/lobby/hosting-tier';
import { tournamentHostingTier } from '../tab/hosting-tier';
import type { HostedTournamentsView } from '@daisy/protocol/lobby/hosting-read';
import type { TabPrincipal } from '../tab/tab-principal';

/** The tournaments a person hosts themselves, with each one's tier and entries. */
export const readHostedTournaments =
  (dependencies: { readonly store: Pick<TabStore, 'hostedTournaments'> }) =>
  (principal: TabPrincipal): Promise<HostedTournamentsView> =>
    dependencies.store.hostedTournaments(principal.userId, async (facts) => ({
      tournaments: facts.tournaments.map((tournament) => {
        // The same rule Entries and Setup enforce, from the same facts.
        const tier = tournamentHostingTier(
          {
            lobbyId: tournament.id,
            ownerUserId: principal.userId,
            ownerOrganizationId: null,
            paidTiers: tournament.paidTiers,
            ownerHosting: facts.hosting,
          },
          facts.hosting.checkedAt,
        );
        return {
          handle: tournament.handle,
          name: tournament.name,
          tier,
          ageRule: tournament.ageRule,
          acceptedEntries: tournament.acceptedEntries,
          entryCap: hostingEntryCap(tier),
        };
      }),
    }));
