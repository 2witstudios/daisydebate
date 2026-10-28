import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { App } from '../../server/app';
import { consumeWindowsOrThrow } from '../../server/rate-limit';
import { memberHttpBoundary } from '../../server/member-handler';
import { appDiscoverActor } from '../account/username-discovery';
import { contactPairFence } from './authorization';
import { blockContact, blockContactByUsername } from './block';
import { createContactHandlers } from './handlers';

/**
 * Contacts' routes: a block spends Contacts' own `contacts:block` budget,
 * and a username lookup the members' one shared discovery budget.
 */
export function composeContactRoutes(app: App) {
  const limit = (actorId: string) =>
    consumeWindowsOrThrow(
      app.limiter,
      `contacts:block:${actorId}`,
      app.contactsPolicy.blocks,
    );
  const dependencies = (principal: AuthorizationPrincipal) => ({
    clock: app.clock,
    limit,
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
        discover: appDiscoverActor(app),
      }),
  });
}
