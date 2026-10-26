import { createMessagingTypingPrivacyPort } from '../privacy/typing-rights';
import { createMessagingTypingStore } from './typing-store';
import { createMessagingPreferenceStore } from './preference-store';
import { createMessagingFileMaintenance } from '../messaging-files/maintenance';
import { createMessagingGroupIssuanceStore } from './group-issuance-store';
import type { MessagingGroupIssuanceFence } from './group-issuance-contracts';
import { createMessagingGroupManagementStore } from './group-management-store';
import type { MessagingGroupManagementFence } from './group-management-contracts';
import { createMessagingGroupCreationStore } from './group-creation-store';
import type { MessagingGroupCreationFence } from './group-creation-contracts';
import { createMessagingGroupInvitationStore } from './group-invitation-store';
import type { MessagingGroupInvitationFence } from './group-invitation-contracts';
import { createMessagingInboxStore } from './inbox-store';
import { createMessagingChannelAuthority } from './authority-frame';
import {
  createMessagingStore,
  createMessagingReactionStore,
  createMessagingFileStore,
  createMessagingDmStore,
  createMessagingFileCleanup,
  type MessagingAuthorizationFence,
  createMessagingSocialStore,
  type MessagingSocialAuthorizationFence,
} from './index';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';

/** Composes messaging stores over the same pool, retaining each authorization fence. */
export function messagingOperations(database: BunSQLDatabase) {
  return {
    messagingInboxStore: (
      authorize: Parameters<typeof createMessagingInboxStore>[1],
    ) => createMessagingInboxStore(database, authorize),
    messagingDmStore: (
      authorize: Parameters<typeof createMessagingDmStore>[0]['authorize'],
    ) => createMessagingDmStore({ database, authorize }),
    messagingChannelAuthority: createMessagingChannelAuthority(database),
    messagingFileMaintenance: createMessagingFileMaintenance(database),
    messagingFileCleanup: (
      authorize: Parameters<typeof createMessagingFileCleanup>[0]['authorize'],
    ) => createMessagingFileCleanup({ database, authorize }),
    messagingFileStore: (
      authorize: Parameters<typeof createMessagingFileStore>[0]['authorize'],
    ) => createMessagingFileStore({ database, authorize }),
    messagingTypingStore: createMessagingTypingStore(database),
    messagingTypingPrivacyPort: (
      producer: Parameters<typeof createMessagingTypingPrivacyPort>[1],
    ) => createMessagingTypingPrivacyPort(database, producer),
    messagingPreferenceStore: (
      authorize: Parameters<typeof createMessagingPreferenceStore>[1],
    ) => createMessagingPreferenceStore(database, authorize),
    messagingChannelStore: (authorize: MessagingAuthorizationFence) =>
      createMessagingStore({ database, authorize }),
    messagingReactionStore: (
      policy: Parameters<typeof createMessagingReactionStore>[1],
      authorize: Parameters<typeof createMessagingReactionStore>[2],
    ) => createMessagingReactionStore(database, policy, authorize),
    messagingGroupCreationStore: (authorize: MessagingGroupCreationFence) =>
      createMessagingGroupCreationStore(database, authorize),
    messagingGroupIssuanceStore: (authorize: MessagingGroupIssuanceFence) =>
      createMessagingGroupIssuanceStore({ database, authorize }),
    messagingGroupManagementStore: (authorize: MessagingGroupManagementFence) =>
      createMessagingGroupManagementStore({ database, authorize }),
    messagingGroupInvitationStore: (authorize: MessagingGroupInvitationFence) =>
      createMessagingGroupInvitationStore({ database, authorize }),
    messagingSocialStore: (authorize: MessagingSocialAuthorizationFence) =>
      createMessagingSocialStore({ database, authorize }),
  };
}
