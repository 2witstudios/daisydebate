import { type MessagingStore } from '@daisy/db/stores/messaging';
import type {
  AuthorizationPrincipal,
  ContactAuthorizationFact,
  SocialCreationFact,
  SocialCreationPolicy,
} from '@daisy/auth/authorization';
import type { Clock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { requireAuthorization } from '@daisy/auth/request-authorization';
import { loadAccountPolicyFacts } from '../authorization/account-policy-facts';
import type { MessagingReadingPolicy } from './authorization-fence';

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
  readingPolicy,
}: {
  readonly principal: AuthorizationPrincipal;
  readonly clock: Clock;
  readonly operation: CreationOperation & { readonly kind: 'dm' };
  readonly readingPolicy: MessagingReadingPolicy;
}): Parameters<MessagingStore['messagingSocialStore']>[0] {
  return async (tx, input, facts, existing) => {
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
    const recipientActorId = input.memberActorIds.find(
      (id) => id !== input.actorId,
    );
    if (!existing && !recipientActorId) throw createAppError('INFRASTRUCTURE');
    const socialAccounts = await loadAccountPolicyFacts(
      tx,
      facts.accounts,
      now,
      existing ? 'reading' : 'posting',
      !existing && recipientActorId
        ? { userId: input.userId, actorId: input.actorId, recipientActorId }
        : undefined,
    );
    if (existing) {
      const dm = existing.authority;
      if (dm.kind !== 'dm') throw createAppError('INFRASTRUCTURE');
      const capability =
        dm.state === 'accepted'
          ? 'channel.read'
          : dm.requestSenderActorId === input.actorId
            ? 'channel.request.status'
            : 'channel.request.read';
      const socialReading = readingPolicy({
        channel: existing,
        accounts: socialAccounts,
        now,
      });
      requireAuthorization({
        principal,
        capability,
        resource: existing,
        context: {
          account,
          now,
          socialAccounts,
          ...(socialReading === undefined ? {} : { socialReading }),
        },
      });
      return;
    }
    const resource = creationResource(
      operation,
      input.actorId,
      input.memberActorIds,
      contacts,
      input.policyRevision,
    );
    requireAuthorization({
      principal,
      capability: 'channel.dm.request',
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
    const recipientActorId = members.find((id) => id !== actorId);
    if (
      members.length !== 2 ||
      contacts.length !== 1 ||
      recipientActorId === undefined
    )
      throw createAppError('VALIDATION');
    return {
      kind: 'social_creation',
      mode: 'dm',
      initiatorActorId: actorId,
      recipientActorId,
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
