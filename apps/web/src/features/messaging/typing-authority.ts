import {
  authorize,
  type AuthorizationInput,
  type ChannelAuthorizationFact,
  type SocialAccountFact,
  type AccountAuthorizationFact,
  type SocialPolicyEvidence,
} from '@daisy/auth/authorization';
import { socialPostingPolicy } from '@daisy/auth/social-policy';
import { messagingTypingSchemas } from '@daisy/protocol';
import type { MessagingRuntimePolicy } from './composition';
type Lease = ReturnType<typeof messagingTypingSchemas.lease.parse>;
export function typingAuthority({
  channels,
  accounts,
  policy,
  now,
}: {
  readonly channels: readonly {
    readonly actorId: string;
    readonly fact: ChannelAuthorizationFact | null;
  }[];
  readonly accounts: readonly SocialAccountFact[];
  readonly policy: MessagingRuntimePolicy;
  readonly now: string;
}) {
  const result: {
    readonly actorId: string;
    readonly input: AuthorizationInput;
    readonly lease: Lease | null;
  }[] = [];
  for (const { actorId, fact } of channels) {
    const self = accounts.find(
      (row) => row.account.actorId === actorId,
    )?.account;
    if (!fact || !self) continue;
    const evidenceInput = { channel: fact, accounts, now };
    const reading = policy.reading(evidenceInput);
    const posting = socialPostingPolicy({
      ...evidenceInput,
      policy:
        fact.authority.kind === 'private_group'
          ? (policy.groupPosting ?? policy.posting)
          : policy.posting,
    });
    const input: AuthorizationInput = {
      principal: { kind: 'user', userId: self.userId, actorId },
      capability: 'channel.read',
      resource: fact,
      context: {
        account: self,
        now,
        socialAccounts: accounts,
        ...(reading === undefined ? {} : { socialReading: reading }),
        socialPosting: posting,
      },
    };
    result.push({
      actorId,
      input,
      lease: authorize({ ...input, capability: 'channel.post' }).allow
        ? boundLease(fact, self, posting, actorId)
        : null,
    });
  }
  return result;
}
type Authority = ReturnType<typeof typingAuthority>;
function qualifies(lease: Lease, current: Lease, now: string) {
  return (
    lease.actorId === current.actorId &&
    lease.channelId === current.channelId &&
    lease.authorityRevision === current.authorityRevision &&
    lease.relationshipRevision === current.relationshipRevision &&
    lease.accountRevision === current.accountRevision &&
    lease.ageRevision === current.ageRevision &&
    lease.policyRevision === current.policyRevision &&
    Date.parse(lease.expiresAt) > Date.parse(now) &&
    Date.parse(lease.expiresAt) <= Date.parse(current.expiresAt)
  );
}
/** Lease existence never grants permission: current canonical post facts qualify it for each read. */
export function typingAggregate(
  authority: Authority,
  leases: readonly Lease[],
  observerId: string,
  now: string,
) {
  const deadlines = leases.flatMap((lease) => {
    if (lease.actorId === observerId) return [];
    const row = authority.find(
      (candidate) => candidate.actorId === lease.actorId,
    );
    if (
      !row?.lease ||
      !qualifies(lease, row.lease, now) ||
      !authorizeAt(row.input, 'channel.post', now)
    )
      return [];
    const readingDeadline = row.input.context.socialReading?.validUntil;
    return [
      Math.min(
        Date.parse(lease.expiresAt),
        Date.parse(readingDeadline ?? row.lease.expiresAt),
      ),
    ];
  });
  return {
    typing: deadlines.length > 0,
    expiresAt: deadlines.length ? Math.min(...deadlines) : null,
  };
}
export function typingProjectionChanged(
  authority: Authority,
  before: readonly Lease[],
  after: readonly Lease[],
  now: string,
) {
  return authority.some(
    (row) =>
      authorizeAt(row.input, 'channel.read', now) &&
      typingAggregate(authority, before, row.actorId, now).typing !==
        typingAggregate(authority, after, row.actorId, now).typing,
  );
}

function boundLease(
  fact: ChannelAuthorizationFact,
  self: AccountAuthorizationFact,
  posting: SocialPolicyEvidence,
  actorId: string,
) {
  const revision = posting.accounts.find((row) => row.actorId === actorId);
  const candidate = messagingTypingSchemas.lease.safeParse({
    version: 1,
    actorId,
    channelId: fact.channelId,
    authorityRevision: fact.revision,
    relationshipRevision:
      fact.authority.kind === 'dm'
        ? fact.authority.revision
        : fact.authority.generation,
    accountRevision: self.revision,
    ageRevision: revision?.ageRevision,
    policyRevision: fact.policyRevision,
    expiresAt: posting.validUntil,
  });
  return candidate.success ? candidate.data : null;
}

function authorizeAt(
  input: AuthorizationInput,
  capability: 'channel.read' | 'channel.post',
  now: string,
) {
  return authorize({ ...input, capability, context: { ...input.context, now } })
    .allow;
}
