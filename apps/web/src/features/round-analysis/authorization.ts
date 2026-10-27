import {
  accountEntitlements,
  authorize,
  type AccountAuthorizationFact,
  type RoundAuthorizationFact,
} from '@daisy/auth/authorization';
import type { RoundAnalysisAccess } from '@daisy/db/rounds';
import type { EntitlementGrant } from '@daisy/protocol';

/** Whether this account may read or generate a round analysis of its own seat in this Round. */
function canAnalyse(
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

/**
 * Whether the seat's own debater may generate (a paid attempt) or read
 * their round analysis; a debater who may not read it sees it locked.
 */
export const canUseRoundAnalysis = (
  access: RoundAnalysisAccess,
  betaGrantsPremium: boolean,
  capability: 'round.analysis.read' | 'round.analysis.generate',
) =>
  canAnalyse(
    access.account,
    access.grants,
    access.round,
    betaGrantsPremium,
    capability,
  );
