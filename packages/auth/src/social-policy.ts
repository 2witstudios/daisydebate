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
/** No numeric, legal, youth or cross-band defaults. Approved configuration is injected at the edge. */
export function socialPostingPolicy({
  channel,
  accounts,
  now,
  policy,
}: {
  readonly channel: ChannelAuthorizationFact;
  readonly accounts: readonly {
    readonly account: AccountAuthorizationFact;
    readonly age: AccountAgeFact;
  }[];
  readonly now: string;
  readonly policy: SocialContactPolicy;
}) {
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
    policy.state !== 'approved' ||
    !policy.decision.trim() ||
    policy.key !== channel.policyKey ||
    policy.revision !== channel.policyRevision ||
    !Number.isFinite(instant) ||
    channel.lifecycle !== 'active' ||
    (authority.kind === 'dm' && authority.blocked) ||
    members.length === 0 ||
    new Set(members).size !== members.length ||
    accounts.length !== members.length ||
    new Set(accounts.map((row) => row.account.actorId)).size !== accounts.length
  )
    return result;
  const current = members.map((actorId) =>
    accounts.find((row) => row.account.actorId === actorId),
  );
  if (
    current.some(
      (row) =>
        !row ||
        !row.account.member ||
        row.account.erased ||
        row.age.state !== 'known' ||
        row.age.actorId !== row.account.actorId ||
        row.age.accountRevision !== row.account.revision ||
        row.age.revision < 1 ||
        !Number.isSafeInteger(row.age.revision) ||
        !Number.isFinite(Date.parse(row.age.validUntil)) ||
        Date.parse(row.age.validUntil) <= instant ||
        row.age.band === 'under-13',
    )
  )
    return result;
  const bands = current.map((row) =>
    row!.age.state === 'known' ? row!.age.band : 'under-13',
  );
  const everyPair = bands.every((band, i) =>
    bands
      .slice(i + 1)
      .every((other) =>
        policy.allowedBandPairs.some(
          ([a, b]) =>
            (band === a && other === b) || (band === b && other === a),
        ),
      ),
  );
  return { ...result, allowed: everyPair };
}
