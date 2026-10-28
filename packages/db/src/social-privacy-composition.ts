import {
  contactsPrivacyAdopter,
  contactsPrivacyExpectedColumns,
} from './contacts/privacy';
import {
  friendsPrivacyAdopter,
  friendsPrivacyExpectedColumns,
} from './friends/privacy';
import { createMessagingPrivacyAdopter } from './messaging/privacy';
import {
  presencePrivacyAdopter,
  presencePrivacyExpectedColumns,
} from './presence/privacy';
import { messagingPrivacyExpectedColumns } from './privacy/messaging-declarations';

/**
 * The social capabilities' subject rights, in their required order:
 * Messaging before authentication is scrubbed, then Friends and Presence,
 * and Contacts last, once nothing built on the pair remains (B5).
 */
export const socialPrivacyAdoption = () => ({
  requiredAdopters: [
    {
      id: 'messaging',
      phase: 'before-auth' as const,
      expectedColumns: messagingPrivacyExpectedColumns,
    },
    {
      id: 'friends',
      phase: 'after-scrub' as const,
      expectedColumns: friendsPrivacyExpectedColumns,
    },
    {
      id: 'presence',
      phase: 'after-scrub' as const,
      expectedColumns: presencePrivacyExpectedColumns,
    },
    {
      id: 'contacts',
      phase: 'after-scrub' as const,
      expectedColumns: contactsPrivacyExpectedColumns,
    },
  ],
  adopters: [
    createMessagingPrivacyAdopter(),
    friendsPrivacyAdopter,
    presencePrivacyAdopter,
    contactsPrivacyAdopter,
  ],
});
