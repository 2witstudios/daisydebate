import { tournamentHostingGrantFor } from '@daisy/auth/authorization';
import type { TournamentHostingFacts } from '@daisy/db/tab';
import {
  effectiveHostingTier,
  type HostingTier,
} from '@daisy/protocol/lobby/hosting-tier';

/**
 * A hosted tournament's tier (ADR 0149). A league's tournament is covered by
 * the league and has no cap; a personal one is the highest tier paid for it,
 * or unlimited while the owner holds a current hosting grant that names it.
 */
export const tournamentHostingTier = (
  facts: TournamentHostingFacts,
  now: string,
): HostingTier =>
  effectiveHostingTier({
    paidTiers: facts.paidTiers,
    granted:
      facts.ownerOrganizationId !== null ||
      (facts.ownerUserId !== null &&
        facts.ownerHosting !== null &&
        tournamentHostingGrantFor(facts.ownerHosting.grants, {
          now,
          userId: facts.ownerUserId,
          tournamentId: facts.lobbyId,
          versionId: null,
        }) !== null),
  });
