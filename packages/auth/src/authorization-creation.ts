import { contactPairValid } from './authorization-contact';
import { policySelfCurrent } from './authorization-policy';
import type {
  AuthorizationCapability,
  AuthorizationInput,
  ContactAuthorizationFact,
  SocialCreationFact,
  SocialCreationPolicy,
} from './authorization-facts';
import { socialAccountsEligible } from './social-policy';
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
function validPair(pair: ContactAuthorizationFact, members: readonly string[]) {
  return (
    contactPairValid(pair) &&
    members.includes(pair.lowActorId) &&
    members.includes(pair.highActorId)
  );
}
function groupPairsCurrent(
  resource: Extract<SocialCreationFact, { mode: 'private_group' }>,
  policy: SocialCreationPolicy,
) {
  if (!['all_pairs', 'initiator'].includes(policy.groupBlockScope ?? ''))
    return false;
  const members = resource.memberActorIds;
  const pairs = resource.contactPairs;
  if (pairs.some((pair) => !validPair(pair, members))) return false;
  if (
    new Set(pairs.map((pair) => `${pair.lowActorId}:${pair.highActorId}`))
      .size !== pairs.length
  )
    return false;
  return members.every((left, index) =>
    members.slice(index + 1).every((right) => {
      if (
        policy.groupBlockScope === 'initiator' &&
        ![left, right].includes(resource.initiatorActorId)
      )
        return true;
      const [low, high] = [left, right].sort();
      const pair = pairs.find(
        (fact) => fact.lowActorId === low && fact.highActorId === high,
      );
      return pair !== undefined && !pair.blocked;
    }),
  );
}
function intentCurrent(
  actorId: string,
  capability: AuthorizationCapability,
  resource: SocialCreationFact,
  policy: SocialCreationPolicy,
) {
  if (actorId !== resource.initiatorActorId) return false;
  if (resource.mode === 'dm')
    return (
      capability === 'social.request.create' &&
      resource.policyKey === 'social.dm' &&
      validPair(resource.contactPair, [actorId, resource.recipientActorId]) &&
      !resource.contactPair.blocked
    );
  return (
    capability === 'channel.create.private_group' &&
    resource.policyKey === 'social.private_group' &&
    resource.memberActorIds.includes(actorId) &&
    groupPairsCurrent(resource, policy)
  );
}
function policyCurrent(
  resource: SocialCreationFact,
  policy: Extract<SocialCreationPolicy, { state: 'approved' }>,
) {
  return (
    positive(resource.policyRevision) &&
    policy.key === resource.policyKey &&
    policy.revision === resource.policyRevision &&
    policy.decision.trim().length > 0
  );
}
function currentAdmission(
  resource: SocialCreationFact,
  context: AuthorizationInput['context'],
) {
  const policy = context.socialCreationPolicy;
  if (
    !policy ||
    policy.state !== 'approved' ||
    !context.now ||
    !context.socialAccounts
  )
    return null;
  if (!policyCurrent(resource, policy) || !policySelfCurrent(context))
    return null;
  const members =
    resource.mode === 'dm'
      ? [resource.initiatorActorId, resource.recipientActorId]
      : resource.memberActorIds;
  return socialAccountsEligible(
    members,
    context.socialAccounts,
    context.now,
    policy,
  )
    ? policy
    : null;
}
export function socialCreationAllowed(
  actorId: string,
  capability: AuthorizationCapability,
  resource: SocialCreationFact,
  context: AuthorizationInput['context'],
): boolean {
  const policy = currentAdmission(resource, context);
  return (
    policy !== null && intentCurrent(actorId, capability, resource, policy)
  );
}
/** Admission to an existing group uses the same explicit policy and pairwise eligibility as creation. */
export function socialGroupAdmissionAllowed(
  resource: Extract<SocialCreationFact, { mode: 'private_group' }>,
  context: AuthorizationInput['context'],
): boolean {
  const policy = currentAdmission(resource, context);
  return policy !== null && groupPairsCurrent(resource, policy);
}
