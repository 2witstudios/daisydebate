import { contactReactions } from '../contact-composition';
import { socialRequestRetention } from '../contacts/request-budget';
import type { ContactAuthorizationFence } from '../contacts/fence';
import type { ContactReactions } from '../contacts/reactions';
import { createContactStore as create } from '../contacts/store';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/**
 * Every capability's reaction to a contact change (DEC-251): the process
 * passes it to the stores built on the contact pair, so each runs its
 * reaction inside the Contacts transaction.
 */
export { contactReactions };

/** Contacts' own commands (blocks) and social request retention, on the social lane. */
export const createContactsStore = (
  resources: DatabaseResources,
  { reactions }: { readonly reactions: ContactReactions },
) => {
  const { lane, eventSink } = resourcesOf(resources);
  const social = lane('social').database;
  return namedLaneOperations({
    contactStore: (authorize: ContactAuthorizationFence) =>
      create({ database: social, authorize, reactions }),
    ...socialRequestRetention({ database: social, eventSink }),
  });
};
export type ContactsStore = ReturnType<typeof createContactsStore>;
