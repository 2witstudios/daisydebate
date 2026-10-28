import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { App } from '../../server/app';
import { consumeWindowsOrThrow } from '../../server/rate-limit';
import { memberHttpBoundary } from '../../server/member-handler';
import { contactPairFence } from './authorization';
import { blockContact, blockContactByUsername } from './block';
import { createContactHandlers } from './handlers';

/** Contacts' routes, spending Contacts' own block and lookup budgets. */
export function composeContactRoutes(app: App) {
  const limit = (bucket: string) => (actorId: string) =>
    consumeWindowsOrThrow(
      app.limiter,
      `contacts:${bucket}:${actorId}`,
      app.contactsPolicy.blocks,
    );
  const dependencies = (principal: AuthorizationPrincipal) => ({
    clock: app.clock,
    limit: limit('block'),
    store: app.database.contactStore(
      contactPairFence({ principal, capability: 'social.block' }),
    ),
  });
  return createContactHandlers({
    boundary: memberHttpBoundary(app),
    block: (input, principal) =>
      blockContact(input, principal, dependencies(principal)),
    blockByUsername: (input, principal) =>
      blockContactByUsername(input, principal, {
        ...dependencies(principal),
        limitLookup: limit('lookup'),
        lookup: (username) => app.database.lookupHumanActorByUsername(username),
      }),
  });
}
