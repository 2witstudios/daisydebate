import { tournamentHostingGrantFor } from '@daisy/auth/authorization';
import type { TabStore } from '@daisy/db/tab';
import {
  effectiveHostingTier,
  hostingEntryCap,
} from '@daisy/protocol/lobby/hosting-tier';
import type { HostedTournamentsView } from '@daisy/protocol/lobby/hosting-read';
import type { TabPrincipal } from '../tab/tab-principal';

/** The tournaments a person hosts themselves, with each one's tier and entries. */
export const readHostedTournaments =
  (dependencies: { readonly store: Pick<TabStore, 'hostedTournaments'> }) =>
  (principal: TabPrincipal): Promise<HostedTournamentsView> =>
    dependencies.store.hostedTournaments(principal.userId, async (facts) => ({
      tournaments: facts.tournaments.map((tournament) => {
        const tier = effectiveHostingTier({
          paidTiers: tournament.paidTiers,
          granted:
            tournamentHostingGrantFor(facts.hosting.grants, {
              now: facts.hosting.checkedAt,
              userId: principal.userId,
              tournamentId: tournament.id,
              versionId: null,
            }) !== null,
        });
        return {
          handle: tournament.handle,
          name: tournament.name,
          tier,
          acceptedEntries: tournament.acceptedEntries,
          entryCap: hostingEntryCap(tier),
        };
      }),
    }));
