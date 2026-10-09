import { currentAgeFact } from './authorization-age';
import type {
  ChannelAuthorizationFact,
  SocialPolicyEvidence,
  SocialAccountFact,
  AuthorizationInput,
} from './authorization-facts';
function policyRevisionsMatch(
  resource: ChannelAuthorizationFact,
  policy: SocialPolicyEvidence,
) {
  const authority = resource.authority;
  return (
    policy.channelId === resource.channelId &&
    policy.policyKey === resource.policyKey &&
    policy.policyRevision === resource.policyRevision &&
    policy.authorityRevision === resource.revision &&
    policy.relationshipRevision ===
      (authority.kind === 'dm' ? authority.revision : authority.generation)
  );
}
function policyTimeCurrent(
  policy: SocialPolicyEvidence,
  now: string | undefined,
) {
  if (now === undefined) return false;
  const instant = Date.parse(now),
    observed = Date.parse(policy.evaluatedAt),
    expiry = Date.parse(policy.validUntil);
  return (
    [instant, observed, expiry].every(Number.isFinite) &&
    observed <= instant &&
    instant < expiry
  );
}
function policyAgeCurrent(
  row: SocialAccountFact,
  now: string,
  posting: boolean,
) {
  if (row.age.state === 'known' && !currentAgeFact(row, now)) return false;
  return !posting || (row.age.state === 'known' && row.age.band !== 'under-13');
}
function policyAccountCurrent(
  row: SocialAccountFact,
  evidence: SocialPolicyEvidence['accounts'][number],
  now: string,
  posting: boolean,
) {
  if (!policyAgeCurrent(row, now, posting)) return false;
  const account = row.account;
  const ageRevision = row.age.state === 'known' ? row.age.revision : null;
  return (
    account.actorId === evidence.actorId &&
    account.userId === evidence.userId &&
    account.revision === evidence.accountRevision &&
    ageRevision === evidence.ageRevision &&
    account.member &&
    !account.erased
  );
}
function policyAccountsCurrent(
  resource: ChannelAuthorizationFact,
  policy: SocialPolicyEvidence,
  context: AuthorizationInput['context'],
  posting: boolean,
) {
  const accounts = context.socialAccounts;
  if (!accounts) return false;
  const authority = resource.authority;
  const members =
    authority.kind === 'dm'
      ? [authority.lowActorId, authority.highActorId]
      : authority.activeMemberActorIds;
  if (
    accounts.length !== members.length ||
    policy.accounts.length !== members.length ||
    new Set(policy.accounts.map((row) => row.actorId)).size !== members.length
  )
    return false;
  return members.every((actorId) => {
    const row = accounts.find((item) => item.account.actorId === actorId),
      evidence = policy.accounts.find((item) => item.actorId === actorId);
    return (
      row !== undefined &&
      evidence !== undefined &&
      policyAccountCurrent(row, evidence, context.now!, posting)
    );
  });
}
export function policySelfCurrent(context: AuthorizationInput['context']) {
  const account = context.account;
  if (!account) return false;
  return (
    context.socialAccounts?.some(
      (row) =>
        row.account.actorId === account.actorId &&
        row.account.userId === account.userId &&
        row.account.revision === account.revision,
    ) === true
  );
}
export function policyEvidenceCurrent(
  resource: ChannelAuthorizationFact,
  policy: SocialPolicyEvidence | undefined,
  context: AuthorizationInput['context'],
  posting = false,
) {
  return (
    policy?.allowed === true &&
    policyRevisionsMatch(resource, policy) &&
    policyTimeCurrent(policy, context.now) &&
    policyAccountsCurrent(resource, policy, context, posting) &&
    policySelfCurrent(context)
  );
}
