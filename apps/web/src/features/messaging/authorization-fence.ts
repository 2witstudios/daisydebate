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
import { requireAuthorization } from '@daisy/auth/request-authorization';

type PolicyInput = {
  readonly channel: ChannelAuthorizationFact;
  readonly accounts: readonly SocialAccountFact[];
  readonly now: string;
};
/** Reading evidence is a canonical producer input, never derived from a grant or preference here. */
export type MessagingReadingPolicy = (
  input: PolicyInput,
) => SocialPolicyEvidence | undefined;

export type MessagingFenceOptions = {
  readonly principal: AuthorizationPrincipal;
  readonly clock: Clock;
  readonly postingPolicy: SocialContactPolicy;
  readonly groupPostingPolicy?: SocialContactPolicy;
  readonly readingPolicy?: MessagingReadingPolicy;
};
type BoundInput = Parameters<MessagingAuthorizationFence>[1];
type BoundFrame = Parameters<MessagingAuthorizationFence>[2];
/** Two operation-specific fences share this same minimal producer, never another evaluator. */
export async function loadMessagingAuthorizationInput(
  tx: Parameters<MessagingAuthorizationFence>[0],
  input: BoundInput,
  frame: BoundFrame,
  options: MessagingFenceOptions,
) {
  requireBoundFrame(options.principal, input, frame.fact.channelId);
  const accounts = await loadAccountPolicyFacts(
    tx,
    frame.accounts,
    options.clock.now(),
  );
  return messagingAuthorizationInput(
    input,
    frame.fact,
    { accounts, now: options.clock.now() },
    options,
  );
}
/** The same producer over policy facts already read under the fences. */
export function messagingAuthorizationInput(
  input: BoundInput,
  fact: BoundFrame['fact'],
  facts: {
    readonly accounts: readonly SocialAccountFact[];
    readonly now: string;
  },
  options: MessagingFenceOptions,
): Omit<AuthorizationInput, 'capability' | 'resource'> & {
  readonly resource: ChannelAuthorizationFact;
} {
  const { principal, postingPolicy, groupPostingPolicy, readingPolicy } =
    options;
  requireBoundFrame(principal, input, fact.channelId);
  const { accounts, now } = facts;
  const policyInput = { channel: fact, accounts, now };
  const reading = readingPolicy?.(policyInput);
  return {
    principal,
    resource: fact,
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
          fact.authority.kind === 'private_group'
            ? (groupPostingPolicy ?? postingPolicy)
            : postingPolicy,
      }),
    },
  };
}
/** Run after account/pair/channel waits in the exact adapter transaction. */
export function messagingAuthorizationFence(
  options: MessagingFenceOptions & {
    readonly capability: AuthorizationCapability;
  },
): MessagingAuthorizationFence {
  return async (tx, input, frame) =>
    requireAuthorization({
      ...(await loadMessagingAuthorizationInput(tx, input, frame, options)),
      capability: options.capability,
    });
}

function requireBoundFrame(
  principal: AuthorizationPrincipal,
  input: BoundInput,
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
