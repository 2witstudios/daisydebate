import { authorize } from '../authorization';
import type {
  ChannelAuthorizationFact,
  SocialAccountFact,
} from '../authorization-facts';
import { policyEvidenceCurrent } from '../authorization-policy';
import {
  socialPolicyEvidence,
  type SocialContactPolicy,
} from '../social-policy';

/** Explicit isolated-fixture policy; never a runtime default or product approval. */
export const messagingTestPosting = {
  state: 'approved',
  decision: 'isolated browser fixture only',
  key: 'social.dm',
  revision: 1,
  allowedBandPairs: [['adult', 'adult']],
} as const satisfies SocialContactPolicy;

function currentBoundMember({ account }: SocialAccountFact) {
  if (account.actorId === null) return false;
  return authorize({
    principal: {
      kind: 'user',
      userId: account.userId,
      actorId: account.actorId,
    },
    capability: 'channel.inbox.read',
    resource: { kind: 'messaging_collection', actorId: account.actorId },
    context: { account },
  }).allow;
}

/**
 * Isolated fixture evidence only. Consumers must still call canonical authorize
 * with freshly fenced facts; this does not grant membership or content access.
 */
export function messagingTestReading({
  channel,
  accounts,
  now,
}: {
  readonly channel: ChannelAuthorizationFact;
  readonly accounts: readonly SocialAccountFact[];
  readonly now: string;
}) {
  const evidence = socialPolicyEvidence(channel, accounts, now);
  const candidate = { ...evidence, allowed: true };
  const allowed =
    channel.authority.kind === 'dm' &&
    channel.policyKey === messagingTestPosting.key &&
    channel.policyRevision === messagingTestPosting.revision &&
    accounts.every(currentBoundMember) &&
    policyEvidenceCurrent(channel, candidate, {
      account: accounts[0]?.account ?? null,
      socialAccounts: accounts,
      now,
    });
  return { ...evidence, allowed };
}
