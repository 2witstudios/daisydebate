import type {
  AuthorizationCapability,
  AuthorizationInput,
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

type FenceOptions = {
  readonly principal: AuthorizationPrincipal;
  readonly clock: Clock;
  readonly postingPolicy: SocialContactPolicy;
  readonly groupPostingPolicy?: SocialContactPolicy;
  readonly readingPolicy?: MessagingReadingPolicy;
};
/** Two operation-specific fences share this same minimal producer, never another evaluator. */
export async function loadMessagingAuthorizationInput(
  tx: Parameters<MessagingAuthorizationFence>[0],
  input: Parameters<MessagingAuthorizationFence>[1],
  frame: Parameters<MessagingAuthorizationFence>[2],
  options: FenceOptions,
): Promise<
  Omit<AuthorizationInput, 'capability' | 'resource'> & {
    readonly resource: ChannelAuthorizationFact;
  }
> {
  const { principal, clock, postingPolicy, groupPostingPolicy, readingPolicy } =
    options;
  requireBoundFrame(principal, input, frame.fact.channelId);
  const accounts = await loadAccountPolicyFacts(
    tx,
    frame.accounts,
    clock.now(),
  );
  const now = clock.now();
  const policyInput = { channel: frame.fact, accounts, now };
  const reading = readingPolicy?.(policyInput);
  return {
    principal,
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
  };
}
/** Run after account/pair/channel waits in the exact adapter transaction. */
export function messagingAuthorizationFence(
  options: FenceOptions & { readonly capability: AuthorizationCapability },
): MessagingAuthorizationFence {
  return async (tx, input, frame) =>
    requireMessagingAuthorization({
      ...(await loadMessagingAuthorizationInput(tx, input, frame, options)),
      capability: options.capability,
    });
}

function requireBoundFrame(
  principal: AuthorizationPrincipal,
  input: Parameters<MessagingAuthorizationFence>[1],
  channelId: string,
) {
  if (
    principal.kind !== 'user' ||
    principal.userId !== input.userId ||
    principal.actorId !== input.actorId ||
    channelId !== input.channelId
  )
    throw createAppError('AUTHORIZATION');
}
