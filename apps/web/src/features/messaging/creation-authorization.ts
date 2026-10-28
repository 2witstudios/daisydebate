import type {
  AuthorizationPrincipal,
  ContactAuthorizationFact,
  SocialCreationFact,
  SocialCreationPolicy,
} from '@daisy/auth/authorization';
import type { Clock } from '@daisy/clock';
import type { ContactAuthorizationFence } from '@daisy/db/contacts';
import { createAppError } from '@daisy/errors';
import { requireAuthorization } from '@daisy/auth/request-authorization';
import { loadAccountPolicyFacts } from '../authorization/account-policy-facts';

type CreationOperation = {
  readonly kind: 'dm' | 'private_group';
  readonly policy: SocialCreationPolicy;
};

/**
 * Messaging's fence for creating a conversation over locked contact pairs: a
 * DM request or a private group. Policy is supplied by its authority; absent
 * approval or group scope fails closed.
 */
export function messagingCreationFence({
  principal,
  clock,
  operation,
}: {
  readonly principal: AuthorizationPrincipal;
  readonly clock: Clock;
  readonly operation: CreationOperation;
}): ContactAuthorizationFence {
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
    requireAuthorization({
      principal,
      capability:
        operation.kind === 'dm'
          ? 'channel.dm.request'
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
  operation: CreationOperation,
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
