import { currentAgeFact } from './authorization-age';
import type { AccountAgeFact } from './account-age';
import type { AgeBand, MessageRequestSetting } from '@daisy/protocol';
import type {
  ChannelAuthorizationFact,
  SocialAccountFact,
  SocialPolicyEvidence,
} from './authorization';
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

/**
 * One question to the DM rule (decision 90). `request` opens a new message
 * request; `conversation` is everything on an existing DM (accepting it,
 * posting, typing), whose initiator is the request's sender.
 */
export type DmQuestion = {
  readonly stage: 'request' | 'conversation';
  readonly initiator: AgeBand;
  readonly recipient: AgeBand;
  /** The pair is an accepted friendship. */
  readonly friends: boolean;
  /** The initiator is one of the recipient's linked adults (ADR 0158). */
  readonly linkedStaff: boolean;
  /** The recipient's own choice; read only for a new request. */
  readonly recipientSetting: MessageRequestSetting;
};

/**
 * Decision 90, DMs like Discord: any member 13 or over may DM any other
 * through a message request, under the recipient's request setting. An
 * adult's first contact with a minor is a friendship, so an adult may ask a
 * minor, or keep posting to one, only while they are friends or the adult is
 * the minor's own linked staff. A minor may always ask an adult. Total: every
 * question has one answer, and an under-13 party is always refused.
 */
export function dmAllowed(question: DmQuestion): boolean {
  const { initiator, recipient, friends, linkedStaff } = question;
  if (initiator === 'under-13' || recipient === 'under-13') return false;
  if (question.stage === 'request') {
    if (question.recipientSetting === 'none') return false;
    if (question.recipientSetting === 'friends' && !friends) return false;
  }
  const adultToMinor = initiator === 'adult' && recipient !== 'adult';
  return !adultToMinor || friends || linkedStaff;
}

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
function currentAccount(
  row: SocialAccount | undefined,
  instant: number,
): row is CurrentAccount {
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
): 'message' | 'befriend' | 'none' {
  const instant = Date.parse(now);
  const initiator = accounts.find(
    (row) => row.account.actorId === initiatorActorId,
  );
  const recipient = accounts.find(
    (row) => row.account.actorId === recipientActorId,
  );
  if (
    initiatorActorId === recipientActorId ||
    !Number.isFinite(instant) ||
    !currentAccount(initiator, instant) ||
    !currentAccount(recipient, instant)
  )
    return 'none';
  const question = dmQuestionOf('request', initiator, recipient);
  if (dmAllowed(question)) return 'message';
  return !question.friends && dmAllowed({ ...question, friends: true })
    ? 'befriend'
    : 'none';
}
