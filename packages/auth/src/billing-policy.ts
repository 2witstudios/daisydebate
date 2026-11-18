import type { EntitlementGrant } from '@daisy/protocol';
import type { AccountAuthorizationFact } from './authorization-facts';
import {
  currentEntitlementGrants,
  type EntitlementEvaluation,
} from './entitlement-validity';
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

/**
 * Premium without a subscription: a current beta grant of AI Rounds, which
 * the allowance treats as Premium (ADR 0146). Display only; every AI use
 * still passes the allowance decision.
 */
export const holdsGrantedPremium = (
  grants: readonly EntitlementGrant[],
  evaluation: EntitlementEvaluation,
): boolean =>
  currentEntitlementGrants(grants, evaluation).some(
    (grant) => grant.source === 'beta' && grant.entitlement === 'ai_rounds',
  );
