import {
  authorize,
  type AuthorizationCapability,
  type AuthorizationPrincipal,
  type SocialAccountFact,
} from '@daisy/auth/authorization';
import type { SocialContactPolicy } from '@daisy/auth/social-policy';
import type {
  MessagingInboxDecision,
  MessagingInboxPageFacts,
} from '@daisy/db/messaging';
import { requireMessagingAuthorization } from './authorization';
import { requireMessagingActor } from './principal';
import {
  messagingAuthorizationInput,
  type MessagingReadingPolicy,
} from './authorization-fence';
import type { MessagingInboxEntry } from './inbox';

type Candidate = MessagingInboxPageFacts['candidates'][number];
type Policies = {
  readonly principal: AuthorizationPrincipal;
  readonly postingPolicy: SocialContactPolicy;
  readonly readingPolicy: MessagingReadingPolicy;
};
/** The entry's own minimal capability, chosen from its current association. */
function channelCapability(
  actorId: string,
  channel: NonNullable<Candidate['channel']>,
): [AuthorizationCapability, MessagingInboxEntry['kind']] {
  const { authority } = channel;
  if (authority.kind === 'dm' && authority.state === 'pending')
    return authority.requestSenderActorId === actorId
      ? ['channel.request.status', 'outgoing_request']
      : ['channel.request.read', 'incoming_request'];
  return authority.kind === 'private_group'
    ? ['channel.read', 'group_conversation']
    : ['channel.read', 'conversation'];
}
function castOf(channel: NonNullable<Candidate['channel']>) {
  return channel.authority.kind === 'dm'
    ? [channel.authority.lowActorId, channel.authority.highActorId]
    : channel.authority.activeMemberActorIds;
}
function channelEntry(
  facts: MessagingInboxPageFacts,
  candidate: Candidate,
  policies: Policies,
): MessagingInboxEntry | null {
  const { channel } = candidate;
  if (!channel) return null;
  const accounts = castOf(channel).map((id) => facts.accounts.get(id));
  // A cast member without a current account is a definitive refusal for this entry only.
  if (accounts.some((row) => row === undefined)) return null;
  const [capability, kind] = channelCapability(
    facts.principal.actorId,
    channel,
  );
  const input = messagingAuthorizationInput(
    {
      channel,
      accounts: accounts as SocialAccountFact[],
      now: facts.now,
    },
    policies,
  );
  return authorize({ ...input, capability }).allow
    ? { channelId: candidate.channelId, kind }
    : null;
}
function invitationEntry(
  facts: MessagingInboxPageFacts,
  candidate: Candidate,
  principal: AuthorizationPrincipal,
): MessagingInboxEntry | null {
  const { invitation } = candidate;
  if (!invitation) return null;
  const { inviterActorId, inviteeActorId } = invitation.invitation;
  const contactAccounts = [inviterActorId, inviteeActorId].flatMap((id) => {
    const row = facts.accounts.get(id);
    return row ? [row.account] : [];
  });
  const allowed = authorize({
    principal,
    capability: 'channel.invitation.read',
    resource: { ...invitation, contactPairs: facts.contactPairs },
    context: { account: facts.account, contactAccounts, now: facts.now },
  }).allow;
  return allowed
    ? { channelId: candidate.channelId, kind: 'incoming_invitation' }
    : null;
}
/** Pure page policy: the collection grant, then each entry's own current capability. */
export function decideMessagingInbox(
  policies: Policies,
): MessagingInboxDecision<MessagingInboxEntry> {
  const { principal } = policies;
  const actor = requireMessagingActor(principal);
  return {
    collection: ({ account, now }) =>
      requireMessagingAuthorization({
        principal,
        capability: 'channel.inbox.read',
        resource: {
          kind: 'messaging_collection',
          actorId: actor.actorId,
        },
        context: { account, now },
      }),
    entries: (facts) =>
      facts.candidates.flatMap((candidate) => {
        if (candidate.hidden) return [];
        const entry =
          channelEntry(facts, candidate, policies) ??
          invitationEntry(facts, candidate, principal);
        return entry ? [entry] : [];
      }),
  };
}
