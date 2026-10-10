import { authorize } from '../authorization';
import type {
  ChannelAuthorizationFact,
  SocialAccountFact,
  SocialCreationPolicy,
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

/** Selected only by isolated group browser tests; DEC127 stays unapproved. */
export const messagingTestGroupPolicy = {
  ...messagingTestPosting,
  key: 'social.private_group',
  groupBlockScope: 'all_pairs',
} as const satisfies SocialCreationPolicy;

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
type ReadingInput = {
  readonly channel: ChannelAuthorizationFact;
  readonly accounts: readonly SocialAccountFact[];
  readonly now: string;
};
function fixtureReading(
  { channel, accounts, now }: ReadingInput,
  policy: typeof messagingTestPosting | typeof messagingTestGroupPolicy,
) {
  const evidence = socialPolicyEvidence(channel, accounts, now);
  const candidate = { ...evidence, allowed: true };
  const allowed =
    `social.${channel.authority.kind}` === policy.key &&
    channel.policyKey === policy.key &&
    channel.policyRevision === policy.revision &&
    accounts.every(currentBoundMember) &&
    policyEvidenceCurrent(channel, candidate, {
      account: accounts[0]?.account ?? null,
      socialAccounts: accounts,
      now,
    });
  return { ...evidence, allowed };
}

export const messagingTestReading = (input: ReadingInput) =>
  fixtureReading(input, messagingTestPosting);
export const messagingTestGroupReading = (input: ReadingInput) =>
  fixtureReading(input, messagingTestGroupPolicy);
