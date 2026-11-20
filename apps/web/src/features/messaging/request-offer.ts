import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { dmRequestOffer } from '@daisy/auth/social-policy';
import { isAppError } from '@daisy/errors';
import type { App } from '../../server/app';
import { loadAccountPolicyFacts } from '../authorization/account-policy-facts';

/**
 * What a profile offers its viewer toward `username` (decision 90): Message,
 * Add friend where only a friendship opens a request, or nothing. A lookup
 * that fails for any reason offers Message, whose request decides and masks
 * every refusal; this read grants nothing.
 */
export async function messageOfferFor(
  app: Pick<App, 'database' | 'clock'>,
  principal: AuthorizationPrincipal,
  username: string,
): Promise<'message' | 'befriend' | 'none'> {
  if (principal.kind !== 'user' || principal.actorId === null) return 'none';
  const self = principal.actorId;
  try {
    // The page already shows this member: a view reads their actor as the
    // profile does, without spending the username discovery budget.
    const other = await app.database.lookupHumanActorByUsername(username);
    if (other === null || other === self) return 'none';
    const now = app.clock.now();
    return await app.database.readMessagingPairFacts(
      [self, other],
      async (tx, accounts, contact) => {
        if (contact === 'blocked') return 'none';
        // A pending or accepted DM is where Message goes, whatever a new
        // request would be answered.
        if (contact === 'open_dm') return 'message';
        return dmRequestOffer(
          await loadAccountPolicyFacts(tx, accounts, now),
          now,
          self,
          other,
        );
      },
    );
  } catch (error) {
    if (isAppError(error)) return 'message';
    throw error;
  }
}
