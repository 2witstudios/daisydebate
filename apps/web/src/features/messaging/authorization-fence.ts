import type {
  AuthorizationCapability,
  AuthorizationPrincipal,
  ChannelAuthorizationFact,
  SocialAccountFact,
  SocialPolicyEvidence,
} from '@daisy/auth/authorization';
import {
  socialPostingPolicy,
  type SocialContactPolicy,
} from '@daisy/auth/social-policy';
import type { Clock } from '@daisy/clock';
import type { MessagingAuthorizationFence } from '@daisy/db/messaging';
import { createAppError } from '@daisy/errors';
import { loadAccountPolicyFacts } from '../authorization/account-policy-facts';
import { requireMessagingAuthorization } from './authorization';

type PolicyInput = {
  readonly channel: ChannelAuthorizationFact;
  readonly accounts: readonly SocialAccountFact[];
  readonly now: string;
};
/** Reading evidence is a canonical producer input, never derived from a grant or preference here. */
export type MessagingReadingPolicy = (
  input: PolicyInput,
) => SocialPolicyEvidence | undefined;

/** Run after account/pair/channel waits in the exact adapter transaction. */
export function messagingAuthorizationFence({
  principal,
  capability,
  clock,
  postingPolicy,
  groupPostingPolicy,
  readingPolicy,
}: {
  readonly principal: AuthorizationPrincipal;
  readonly capability: AuthorizationCapability;
  readonly clock: Clock;
  readonly postingPolicy: SocialContactPolicy;
  readonly groupPostingPolicy?: SocialContactPolicy;
  readonly readingPolicy?: MessagingReadingPolicy;
}): MessagingAuthorizationFence {
  return async (tx, input, frame) => {
    if (
      principal.kind !== 'user' ||
      principal.userId !== input.userId ||
      principal.actorId !== input.actorId
    )
      throw createAppError('AUTHORIZATION');
    const now = clock.now();
    const accounts = await loadAccountPolicyFacts(tx, frame.accounts, now);
    const policyInput = { channel: frame.fact, accounts, now };
    const reading = readingPolicy?.(policyInput);
    requireMessagingAuthorization({
      principal,
      capability,
      resource: frame.fact,
      context: {
        account:
          accounts.find((row) => row.account.actorId === input.actorId)
            ?.account ?? null,
        now,
        socialAccounts: accounts,
        ...(reading === undefined ? {} : { socialReading: reading }),
        socialPosting: socialPostingPolicy({
          ...policyInput,
          policy:
            frame.fact.authority.kind === 'private_group'
              ? (groupPostingPolicy ?? postingPolicy)
              : postingPolicy,
        }),
      },
    });
  };
}
