import { currentAgeFact } from './authorization-age';
import type { AccountAgeFact } from './account-age';
import type { AgeBand } from './age-band';
import type {
  AccountAuthorizationFact,
  ChannelAuthorizationFact,
  SocialPolicyEvidence,
} from './authorization';
export type SocialContactPolicy =
  | { readonly state: 'pending' }
  | {
      readonly state: 'approved';
      readonly decision: string;
      readonly key: string;
      readonly revision: number;
      readonly allowedBandPairs: readonly (readonly [
        Exclude<AgeBand, 'under-13'>,
        Exclude<AgeBand, 'under-13'>,
      ])[];
    };

type SocialAccount = {
  readonly account: AccountAuthorizationFact;
  readonly age: AccountAgeFact;
};
type PostingInput = {
  readonly channel: ChannelAuthorizationFact;
  readonly accounts: readonly SocialAccount[];
  readonly now: string;
  readonly policy: SocialContactPolicy;
};
function policyMatches(
  channel: ChannelAuthorizationFact,
  policy: SocialContactPolicy,
): policy is Extract<SocialContactPolicy, { state: 'approved' }> {
  return (
    policy.state === 'approved' &&
    policy.decision.trim().length > 0 &&
    policy.key === channel.policyKey &&
    policy.revision === channel.policyRevision
  );
}
function memberSetMatches(
  members: readonly string[],
  accounts: readonly SocialAccount[],
) {
  return (
    members.length > 0 &&
    new Set(members).size === members.length &&
    accounts.length === members.length &&
    new Set(accounts.map((row) => row.account.actorId)).size === accounts.length
  );
}
function currentAccount(
  row: SocialAccount | undefined,
  instant: number,
): row is SocialAccount & { age: Extract<AccountAgeFact, { state: 'known' }> } {
  return (
    row !== undefined &&
    row.account.member &&
    !row.account.erased &&
    Number.isSafeInteger(row.account.revision) &&
    row.account.revision > 0 &&
    currentAgeFact(row, new Date(instant).toISOString()) &&
    row.age.state === 'known' &&
    row.age.band !== 'under-13'
  );
}
function allowsPair(
  policy: Extract<SocialContactPolicy, { state: 'approved' }>,
  band: AgeBand,
  other: AgeBand,
) {
  return policy.allowedBandPairs.some(
    ([a, b]) => (band === a && other === b) || (band === b && other === a),
  );
}
/** No numeric, legal, youth or cross-band defaults. Approved configuration is injected at the edge. */
export function socialPostingPolicy({
  channel,
  accounts,
  now,
  policy,
}: PostingInput) {
  const authority = channel.authority;
  const result = socialPolicyEvidence(channel, accounts, now);
  const members =
    authority.kind === 'dm'
      ? [authority.lowActorId, authority.highActorId]
      : authority.activeMemberActorIds;
  const instant = Date.parse(now);
  if (
    !policyMatches(channel, policy) ||
    !Number.isFinite(instant) ||
    channel.lifecycle !== 'active' ||
    (authority.kind === 'dm' && authority.blocked) ||
    !memberSetMatches(members, accounts)
  )
    return result;
  return {
    ...result,
    allowed: socialAccountsEligible(members, accounts, now, policy),
  };
}
/** Evaluate prospective participants directly; no channel or grant is minted. */
export function socialAccountsEligible(
  members: readonly string[],
  accounts: readonly SocialAccount[],
  now: string,
  policy: SocialContactPolicy,
): boolean {
  const instant = Date.parse(now);
  if (
    policy.state !== 'approved' ||
    !Number.isFinite(instant) ||
    !memberSetMatches(members, accounts)
  )
    return false;
  const current = members.map((actorId) =>
    accounts.find((row) => row.account.actorId === actorId),
  );
  const valid = current.filter((row) => currentAccount(row, instant));
  if (valid.length !== current.length) return false;
  const bands = valid.map((row) => row.age.band);
  return bands.every((band, i) =>
    bands.slice(i + 1).every((other) => allowsPair(policy, band, other)),
  );
}

/** Current account revisions and source deadlines are part of every allowance. */
export function socialPolicyEvidence(
  channel: ChannelAuthorizationFact,
  accounts: readonly SocialAccount[],
  now: string,
): SocialPolicyEvidence {
  const authority = channel.authority;
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime()))
    return invalidPolicyEvidence(channel, now);
  const nextMonth = new Date(instant);
  nextMonth.setUTCDate(1);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  nextMonth.setUTCHours(0, 0, 0, 0);
  const expiry = Math.min(
    nextMonth.getTime(),
    ...accounts.map((row) =>
      row.age.state === 'known'
        ? Date.parse(row.age.validUntil)
        : nextMonth.getTime(),
    ),
  );
  const evidence = accounts.map((row) => ({
    actorId: row.account.actorId ?? '',
    userId: row.account.userId,
    accountRevision: row.account.revision,
    ageRevision: row.age.state === 'known' ? row.age.revision : null,
  }));
  return {
    channelId: channel.channelId,
    policyKey: channel.policyKey,
    policyRevision: channel.policyRevision,
    authorityRevision: channel.revision,
    relationshipRevision:
      authority.kind === 'dm' ? authority.revision : authority.generation,
    evaluatedAt: now,
    validUntil: Number.isFinite(expiry) ? new Date(expiry).toISOString() : '',
    accounts: evidence,
    allowed: false,
  };
}
function invalidPolicyEvidence(
  channel: ChannelAuthorizationFact,
  now: string,
): SocialPolicyEvidence {
  return {
    channelId: channel.channelId,
    policyKey: channel.policyKey,
    policyRevision: channel.policyRevision,
    authorityRevision: channel.revision,
    relationshipRevision: 0,
    evaluatedAt: now,
    validUntil: '',
    accounts: [],
    allowed: false,
  };
}
