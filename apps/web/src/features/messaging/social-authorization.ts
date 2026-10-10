import type {
  AuthorizationPrincipal,
  ContactAuthorizationFact,
  ContactPairAuthorizationFact,
  SocialCreationFact,
  SocialCreationPolicy,
} from '@daisy/auth/authorization';
import type { Clock } from '@daisy/clock';
import type { MessagingSocialAuthorizationFence } from '@daisy/db/messaging';
import { createAppError } from '@daisy/errors';
import { loadAccountPolicyFacts } from '../authorization/account-policy-facts';
import { requireMessagingAuthorization } from './authorization';

/** Policy is supplied by its authority; absent approval or group scope fails closed. */
export function messagingSocialAuthorizationFence({
  principal,
  clock,
  operation,
}: {
  readonly principal: AuthorizationPrincipal;
  readonly clock: Clock;
  readonly operation:
    | { readonly kind: 'block' }
    | {
        readonly kind: 'dm' | 'private_group';
        readonly policy: SocialCreationPolicy;
      };
}): MessagingSocialAuthorizationFence {
  return async (tx, input, facts) => {
    if (
      principal.kind !== 'user' ||
      principal.userId !== input.userId ||
      principal.actorId !== input.actorId
    )
      throw createAppError('AUTHORIZATION');
    const account =
      facts.accounts.find((row) => row?.actorId === input.actorId) ?? null;
    const contacts: readonly ContactAuthorizationFact[] = facts.contacts;
    if (operation.kind === 'block') {
      if (contacts.length !== 1) throw createAppError('VALIDATION');
      const resource: ContactPairAuthorizationFact = {
        ...contacts[0]!,
        kind: 'contact_pair',
      };
      requireMessagingAuthorization({
        principal,
        capability: 'social.block',
        resource,
        context: {
          account,
          contactAccounts: facts.accounts.filter((row) => row !== null),
        },
      });
      return;
    }
    const now = clock.now();
    const socialAccounts = await loadAccountPolicyFacts(
      tx,
      facts.accounts,
      now,
    );
    const resource = creationResource(
      operation,
      input.actorId,
      input.memberActorIds,
      contacts,
      input.policyRevision,
    );
    requireMessagingAuthorization({
      principal,
      capability:
        operation.kind === 'dm'
          ? 'social.request.create'
          : 'channel.create.private_group',
      resource,
      context: {
        account,
        now,
        socialAccounts,
        socialCreationPolicy: operation.policy,
      },
    });
  };
}
export function creationResource(
  operation: {
    readonly kind: 'dm' | 'private_group';
    readonly policy: SocialCreationPolicy;
  },
  actorId: string,
  members: readonly string[],
  contacts: readonly ContactAuthorizationFact[],
  policyRevision: number | undefined,
): SocialCreationFact {
  if (operation.policy.state !== 'approved')
    throw createAppError('INFRASTRUCTURE');
  if (policyRevision === undefined) throw createAppError('INFRASTRUCTURE');
  const revision = policyRevision;
  if (operation.kind === 'dm') {
    if (members.length !== 2 || contacts.length !== 1)
      throw createAppError('VALIDATION');
    return {
      kind: 'social_creation',
      mode: 'dm',
      initiatorActorId: actorId,
      recipientActorId: members.find((id) => id !== actorId)!,
      policyKey: 'social.dm',
      policyRevision: revision,
      contactPair: contacts[0]!,
    };
  }
  return {
    kind: 'social_creation',
    mode: 'private_group',
    initiatorActorId: actorId,
    memberActorIds: members,
    policyKey: 'social.private_group',
    policyRevision: revision,
    contactPairs: contacts,
  };
}
