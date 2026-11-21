import { instantMs, tryInstantMs } from '@daisy/clock';
import { currentAgeFact } from './authorization-age';
import type { AccountAgeFact } from './account-age';
import {
  dmAllowed,
  dmRequestAction,
  type DmQuestion,
  type DmRequestAction,
} from '@daisy/protocol/dm-policy';
import type {
  ChannelAuthorizationFact,
  SocialAccountFact,
  SocialPolicyEvidence,
} from './authorization';
export { dmAllowed, type DmQuestion } from '@daisy/protocol/dm-policy';

export type SocialContactPolicy =
  | { readonly state: 'pending' }
  | {
      readonly state: 'approved';
      readonly decision: string;
      readonly key: string;
      /** The revision a new channel is minted under. */
      readonly revision: number;
      /** Earlier revisions whose channels stay readable and postable. */
      readonly earlierRevisions: readonly number[];
    };

type SocialAccount = SocialAccountFact;
type CurrentAccount = SocialAccount & {
  age: Extract<AccountAgeFact, { state: 'known' }>;
};
/** Who asks on a DM: the initiator and the stage; a group has neither. */
type DmInitiation = {
  readonly stage: DmQuestion['stage'];
  readonly initiatorActorId: string;
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
    honoursRevision(policy, channel.policyRevision)
  );
}
/** The current revision, or an earlier one the policy still honours. */
export function honoursRevision(
  policy: Extract<SocialContactPolicy, { state: 'approved' }>,
  revision: number,
) {
  return (
    policy.revision === revision || policy.earlierRevisions.includes(revision)
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
function currentMember(row: SocialAccount | undefined): row is SocialAccount {
  return (
    row !== undefined &&
    row.account.member &&
    !row.account.erased &&
    Number.isSafeInteger(row.account.revision) &&
    row.account.revision > 0
  );
}
function currentAccount(
  row: SocialAccount | undefined,
  instant: number,
): row is CurrentAccount {
  return (
    currentMember(row) &&
    currentAgeFact(row, new Date(instant).toISOString()) &&
    row.age.state === 'known' &&
    row.age.band !== 'under-13'
  );
}

/** The fenced request read evaluated this direction at the database instant. */
function scopedRequestAction(
  initiator: SocialAccount | undefined,
  recipient: SocialAccount | undefined,
): DmRequestAction | undefined {
  const request = recipient?.contact?.dmRequest;
  if (!request) return undefined;
  if (
    !currentMember(initiator) ||
    !currentMember(recipient) ||
    request.initiatorActorId !== initiator.account.actorId
  )
    return 'none';
  return request.action;
}
/** The rule's question for one asker and one asked, from their own facts. */
function dmQuestionOf(
  stage: DmQuestion['stage'],
  initiator: CurrentAccount,
  recipient: CurrentAccount,
): DmQuestion {
  return {
    stage,
    initiator: initiator.age.band,
    recipient: recipient.age.band,
    friends:
      initiator.contact?.friendActorIds.includes(
        recipient.account.actorId ?? '',
      ) === true,
    linkedStaff:
      recipient.contact?.linkedAdultUserIds.includes(
        initiator.account.userId,
      ) === true,
    // A recipient whose setting was not read is asked as if they chose no one.
    recipientSetting: recipient.contact?.requestSetting ?? 'none',
    protectedMessageRequests:
      recipient.contact?.protectedMessageRequests ?? null,
  };
}
/**
 * A group pair carries no friendship, staff link or setting, and must be
 * allowed whichever of the two asks: so a group never mixes an adult and a
 * minor (private groups are off, DEC-127).
 */
function groupPairAllowed(a: CurrentAccount, b: CurrentAccount) {
  const plain = (initiator: CurrentAccount, recipient: CurrentAccount) =>
    dmAllowed({
      stage: 'conversation',
      initiator: initiator.age.band,
      recipient: recipient.age.band,
      friends: false,
      linkedStaff: false,
      recipientSetting: 'none',
    });
  return plain(a, b) && plain(b, a);
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
  const instant = tryInstantMs(now);
  if (
    !policyMatches(channel, policy) ||
    instant === undefined ||
    channel.lifecycle !== 'active' ||
    (authority.kind === 'dm' && authority.blocked) ||
    !memberSetMatches(members, accounts)
  )
    return result;
  return {
    ...result,
    allowed: socialAccountsEligible(
      members,
      accounts,
      now,
      policy,
      authority.kind === 'dm'
        ? {
            stage: 'conversation',
            initiatorActorId: authority.requestSenderActorId,
          }
        : null,
    ),
  };
}
/**
 * Evaluate prospective participants directly; no channel or grant is minted.
 * A DM (two members and an initiation) answers `dmAllowed`; a group holds
 * every pair to it with no relation.
 */
export function socialAccountsEligible(
  members: readonly string[],
  accounts: readonly SocialAccount[],
  now: string,
  policy: SocialContactPolicy,
  initiation: DmInitiation | null,
): boolean {
  const instant = tryInstantMs(now);
  if (
    policy.state !== 'approved' ||
    instant === undefined ||
    !memberSetMatches(members, accounts)
  )
    return false;
  const current = members.map((actorId) =>
    accounts.find((row) => row.account.actorId === actorId),
  );
  if (initiation?.stage === 'request' && members.length === 2) {
    const initiator = current.find(
      (row) => row?.account.actorId === initiation.initiatorActorId,
    );
    const recipient = current.find((row) => row !== initiator);
    const action = scopedRequestAction(initiator, recipient);
    if (action !== undefined) return action === 'message';
  }
  const valid = current.filter((row) => currentAccount(row, instant));
  if (valid.length !== current.length) return false;
  if (initiation !== null) {
    const initiator = valid.find(
      (row) => row.account.actorId === initiation.initiatorActorId,
    );
    const recipient = valid.find((row) => row !== initiator);
    return (
      valid.length === 2 &&
      initiator !== undefined &&
      recipient !== undefined &&
      dmAllowed(dmQuestionOf(initiation.stage, initiator, recipient))
    );
  }
  return valid.every((row, i) =>
    valid.slice(i + 1).every((other) => groupPairAllowed(row, other)),
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
        ? instantMs(row.age.validUntil)
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

/**
 * The DM contact policy: DEC-251's bounds under decision 90's `dmAllowed`
 * (ADR 0160). Revision 2 replaces revision 1's same-band pairs; every
 * revision-1 channel joined two adults or two 16-17s, which `dmAllowed` also
 * allows, so those channels stay readable and postable. One value for every
 * process that evaluates DM posting or reading (web commands, realtime
 * subscriptions and observation permits), so they cannot diverge.
 */
export const betaDmPolicy = {
  state: 'approved',
  decision: 'DEC-251, decision 90',
  key: 'social.dm',
  revision: 2,
  earlierRevisions: [1],
} as const satisfies SocialContactPolicy;

/**
 * What a page offers one member toward another (decision 90): `message` when
 * a request would be allowed now, `befriend` when only a friendship would
 * open it (an adult toward a minor, or a recipient taking requests from
 * friends only; the two read the same, so nothing shows an age), and `none`
 * otherwise. It grants nothing: the request decides under its own locks.
 */
export function dmRequestOffer(
  accounts: readonly SocialAccount[],
  now: string,
  initiatorActorId: string,
  recipientActorId: string,
): DmRequestAction {
  const instant = tryInstantMs(now);
  const initiator = accounts.find(
    (row) => row.account.actorId === initiatorActorId,
  );
  const recipient = accounts.find(
    (row) => row.account.actorId === recipientActorId,
  );
  if (initiatorActorId === recipientActorId || instant === undefined)
    return 'none';
  const action = scopedRequestAction(initiator, recipient);
  if (action !== undefined) return action;
  if (
    !currentAccount(initiator, instant) ||
    !currentAccount(recipient, instant)
  )
    return 'none';
  return dmRequestAction(dmQuestionOf('request', initiator, recipient));
}
