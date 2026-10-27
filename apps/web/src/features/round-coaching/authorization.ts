import {
  accountEntitlements,
  authorize,
  type AccountAuthorizationFact,
  type RoundAuthorizationFact,
} from '@daisy/auth/authorization';
import type { RoundCoachingAccess } from '@daisy/db/rounds';

export function canCoach(
  account: AccountAuthorizationFact | null,
  round: RoundAuthorizationFact,
  betaGrantsPremium: boolean,
  capability: 'round.coaching.read' | 'round.coaching.generate',
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
      entitlements: accountEntitlements(account, { betaGrantsPremium }),
    },
  }).allow;
}

/** At least one entitled debater must benefit before any paid coaching attempt. */
export function canGenerateCoaching(
  access: RoundCoachingAccess,
  betaGrantsPremium: boolean,
) {
  return access.accounts.some((account) =>
    canCoach(
      account,
      access.round,
      betaGrantsPremium,
      'round.coaching.generate',
    ),
  );
}
