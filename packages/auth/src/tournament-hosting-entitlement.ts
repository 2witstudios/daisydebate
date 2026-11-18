import type { EntitlementGrant, TournamentHostingGrant } from '@daisy/protocol';
import { currentEntitlementGrants } from './entitlement-validity';

/** Coverage is explicit; holding the capability alone never authorizes an arbitrary tournament. */
export const tournamentHostingGrantFor = (
  grants: readonly EntitlementGrant[],
  input: {
    readonly now: string;
    readonly userId: string;
    readonly tournamentId: string;
    readonly versionId: string | null;
  },
): TournamentHostingGrant | null =>
  currentEntitlementGrants(grants, {
    now: input.now,
    betaGrantsPremium: false,
  }).find(
    (grant): grant is TournamentHostingGrant =>
      grant.entitlement === 'tournament_hosting' &&
      grant.hosting.userId === input.userId &&
      grant.hosting.coverage.tournamentIds.includes(input.tournamentId) &&
      (input.versionId === null || grant.hosting.id === input.versionId),
  ) ?? null;
