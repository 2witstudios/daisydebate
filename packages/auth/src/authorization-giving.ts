import {
  allowUnder,
  deny,
  type AuthorizationDecision,
} from './authorization-decision';
import {
  coveringGrants,
  holdingDecision,
  holds,
  ownerAuthority,
  type AuthorityTarget,
  type Holder,
} from './authorization-holding';
import type { RoleGivenFact } from './authorization-lobby-facts';

/**
 * Giving or removing a role: the giver holds every permission in it at the
 * target, and the role sits below the giver's most senior role there. An
 * owner outranks every role. A role of `null` asks only whether the person
 * manages roles at all; an absent role is an incomplete question.
 */
export function givingDecision(
  holder: Holder,
  target: AuthorityTarget,
  role: RoleGivenFact | null | undefined,
): AuthorizationDecision {
  if (role === undefined) return deny('denied');
  const manages = holds(holder, 'organization.roles.manage', target);
  if (!manages.held || role === null) return holdingDecision(manages);
  const holdsAll = role.permissions.every(
    (permission) => holds(holder, permission, target).held,
  );
  const outranks =
    ownerAuthority(holder.actorId, target) !== null ||
    coveringGrants(holder, target).some(
      (grant) => grant.roleRank > role.roleRank,
    );
  return holdsAll && outranks
    ? allowUnder(manages.authority)
    : deny('missing-capability');
}
