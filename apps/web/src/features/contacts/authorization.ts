import type {
  AuthorizationPrincipal,
  ContactAuthorizationFact,
  ContactPairAuthorizationFact,
  ContactPairCapability,
} from '@daisy/auth/authorization';
import type { ContactAuthorizationFence } from '@daisy/db/contacts';
import { createAppError } from '@daisy/errors';
import { requireAuthorization } from '@daisy/auth/request-authorization';

/**
 * The fence for one command on one contact pair: the principal must be the
 * acting member, and `capability` is decided on the locked pair and both
 * locked accounts. Capabilities that create channels belong to Messaging.
 */
export function contactPairFence({
  principal,
  capability,
}: {
  readonly principal: AuthorizationPrincipal;
  readonly capability: ContactPairCapability;
}): ContactAuthorizationFence {
  return async (_tx, input, facts) => {
    if (
      principal.kind !== 'user' ||
      principal.userId !== input.userId ||
      principal.actorId !== input.actorId
    )
      throw createAppError('AUTHORIZATION');
    const contacts: readonly ContactAuthorizationFact[] = facts.contacts;
    if (contacts.length !== 1) throw createAppError('VALIDATION');
    const resource: ContactPairAuthorizationFact = {
      ...contacts[0]!,
      kind: 'contact_pair',
    };
    requireAuthorization({
      principal,
      capability,
      resource,
      context: {
        account:
          facts.accounts.find((row) => row?.actorId === input.actorId) ?? null,
        contactAccounts: facts.accounts.filter((row) => row !== null),
      },
    });
  };
}
