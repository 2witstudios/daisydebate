import {
  roundFloorRetentionMs,
  type RoundFloorFact,
} from '@daisy/protocol/round-floor';
import type { AccountAuthorizationFact } from './authorization-facts';
import { participantAccess } from './participant-access';

type FloorDecisionInput = {
  readonly principal: { readonly userId: string; readonly actorId: string };
  readonly account: AccountAuthorizationFact | null;
  readonly fact: RoundFloorFact;
  readonly action: 'read' | 'post' | 'remove';
  readonly now: string;
};
const boundEligibleAccount = ({
  principal,
  account,
  action,
}: FloorDecisionInput) =>
  account !== null &&
  account.member &&
  !account.erased &&
  (action === 'remove' || participantAccess(account)) &&
  account.userId === principal.userId &&
  account.actorId === principal.actorId;
const currentAudience = ({ fact, principal }: FloorDecisionInput) =>
  fact.actorId === principal.actorId &&
  fact.audience !== null &&
  fact.policyKey === 'round.floor' &&
  fact.policyRevision === 1 &&
  Number.isSafeInteger(fact.revision) &&
  fact.revision > 0;

/** Current eligible humans in this Round's original named audience, including after forfeit. */
export function decideRoundFloor(input: FloorDecisionInput):
  | { readonly allow: false }
  | {
      readonly allow: true;
      readonly readOnly: boolean;
      readonly expiresAt: string | null;
    } {
  const { fact, action, now } = input;
  const instant = Date.parse(now);
  if (
    !Number.isFinite(instant) ||
    !boundEligibleAccount(input) ||
    !currentAudience(input)
  )
    return { allow: false };
  const terminal = ['completed', 'abandoned'].includes(fact.status);
  if (!terminal)
    return fact.completedAt === null
      ? { allow: true, readOnly: false, expiresAt: null }
      : { allow: false };
  const expiry = Date.parse(fact.completedAt ?? '') + roundFloorRetentionMs;
  if (!Number.isFinite(expiry) || instant >= expiry || action === 'post')
    return { allow: false };
  return {
    allow: true,
    readOnly: true,
    expiresAt: new Date(expiry).toISOString(),
  };
}
