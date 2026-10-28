import { contactsPrivacyAdopter } from './contacts/privacy';
import { friendsPrivacyAdopter } from './friends/privacy';
import { createMessagingPrivacyAdopter } from './messaging/privacy';
import { presencePrivacyAdopter } from './presence/privacy';

/**
 * The social capabilities' subject rights, in their required order:
 * Messaging before authentication is scrubbed, then Friends and Presence,
 * and Contacts last, once nothing built on the pair remains (B5).
 */
export const socialPrivacyAdoption = () => [
  createMessagingPrivacyAdopter(),
  friendsPrivacyAdopter,
  presencePrivacyAdopter,
  contactsPrivacyAdopter,
];
