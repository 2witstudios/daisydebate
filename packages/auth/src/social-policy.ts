import type { AccountAgeFact } from './account-age';
import type { AgeBand } from './age-band';
import type {
  AccountAuthorizationFact,
  ChannelAuthorizationFact,
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
function validAge(row: SocialAccount, instant: number) {
  if (row.age.state !== 'known') return false;
  const age = row.age;
  return (
    age.actorId === row.account.actorId &&
    age.accountRevision === row.account.revision &&
    Number.isSafeInteger(age.revision) &&
    age.revision > 0 &&
    age.band !== 'under-13' &&
    Number.isFinite(Date.parse(age.validUntil)) &&
    Date.parse(age.validUntil) > instant
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
    validAge(row, instant)
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
  const result = {
    channelId: channel.channelId,
    policyKey: channel.policyKey,
    policyRevision: channel.policyRevision,
    authorityRevision: channel.revision,
    relationshipRevision:
      authority.kind === 'dm' ? authority.revision : authority.generation,
    allowed: false,
  };
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
  const current = members.map((actorId) =>
    accounts.find((row) => row.account.actorId === actorId),
  );
  const valid = current.filter((row) => currentAccount(row, instant));
  if (valid.length !== current.length) return result;
  const bands = valid.map((row) => row.age.band);
  return {
    ...result,
    allowed: bands.every((band, i) =>
      bands.slice(i + 1).every((other) => allowsPair(policy, band, other)),
    ),
  };
}
