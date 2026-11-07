import type { AccountAuthorizationFact } from './authorization-facts';
import { participantAccess } from './participant-access';

/** Current own billing remains manageable after participant access is withdrawn. */
export const canManageBilling = (
  account: AccountAuthorizationFact | null,
): boolean =>
  account !== null &&
  account.member &&
  !account.erased &&
  account.actorId !== null;

/** Release admission is separately fenced by Flags in the durable purchase transaction. */
export const canPurchasePremium = (
  account: AccountAuthorizationFact | null,
): boolean => canManageBilling(account) && participantAccess(account);
