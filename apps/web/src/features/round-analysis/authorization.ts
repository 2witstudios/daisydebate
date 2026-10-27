import {
  accountEntitlements,
  authorize,
  type AccountAuthorizationFact,
  type RoundAuthorizationFact,
} from '@daisy/auth/authorization';
import type { RoundAnalysisAccess } from '@daisy/db/rounds';
import type { EntitlementGrant } from '@daisy/protocol';

/** Whether this account may read or generate a round analysis of its own seat in this Round. */
export function canAnalyse(
  account: AccountAuthorizationFact | null,
  grants: readonly EntitlementGrant[],
  round: RoundAuthorizationFact,
  betaGrantsPremium: boolean,
  capability: 'round.analysis.read' | 'round.analysis.generate',
) {
  if (!account?.actorId) return false;
  return authorize({
    principal: {
      kind: 'user',
      userId: account.userId,
      actorId: account.actorId,
    },
    capability,
    resource: round,
    context: {
      account,
      entitlements: accountEntitlements(grants, { betaGrantsPremium }),
    },
  }).allow;
}

/** A paid analysis attempt is made only for a seat whose own debater is entitled. */
export const canGenerateRoundAnalysis = (
  access: RoundAnalysisAccess,
  betaGrantsPremium: boolean,
) =>
  canAnalyse(
    access.account,
    access.grants,
    access.round,
    betaGrantsPremium,
    'round.analysis.generate',
  );

/** Whether the seat's debater may read their analysis (otherwise they see it locked). */
export const canReadRoundAnalysis = (
  access: RoundAnalysisAccess,
  betaGrantsPremium: boolean,
) =>
  canAnalyse(
    access.account,
    access.grants,
    access.round,
    betaGrantsPremium,
    'round.analysis.read',
  );
