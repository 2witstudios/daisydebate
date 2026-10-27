import type { ContactReactions } from './contacts/reactions';
import { friendContactReactions } from './friends/contact-reactions';
import { messagingContactReactions } from './messaging/contact-reactions';

/**
 * The database's composition root for Contacts: every capability built on
 * the contact pair registers its block reaction and its DEC-251 relation
 * here, so Contacts itself names none of them.
 */
export const contactReactions: ContactReactions = {
  onBlock: [friendContactReactions.onBlock, messagingContactReactions.onBlock],
  relations: [
    friendContactReactions.relation,
    messagingContactReactions.relation,
  ],
};
