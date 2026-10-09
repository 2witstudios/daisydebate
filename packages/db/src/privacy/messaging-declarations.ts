import type { PrivacyFieldDeclaration } from './contracts';

/** Dedicated MSG schema source 0b1babf2e769d37e81f5a06d1142ebb3c85a2cac. */
const messagingColumns = {
  messaging_channels: {
    identifier: ['id'],
    personal: ['title'],
    none: [
      'kind',
      'policy_key',
      'policy_revision',
      'lifecycle',
      'message_sequence',
      'change_version',
      'authority_revision',
      'created_at',
    ],
  },
  messaging_actor_states: {
    identifier: [],
    personal: [
      'channel_id',
      'actor_id',
      'following',
      'hidden',
      'notification_level',
      'read_sequence',
    ],
    none: [],
  },
  messaging_contact_pairs: {
    identifier: [],
    personal: [
      'low_actor_id',
      'high_actor_id',
      'low_blocks_high',
      'high_blocks_low',
    ],
    none: ['revision'],
  },
  messaging_dm_pairs: {
    identifier: ['channel_id'],
    personal: [
      'low_actor_id',
      'high_actor_id',
      'request_sender_actor_id',
      'request_state',
      'requested_at',
      'decided_at',
    ],
    none: ['channel_kind'],
  },
  messaging_group_grants: {
    identifier: [],
    personal: [
      'channel_id',
      'actor_id',
      'role',
      'generation',
      'granted_at',
      'revoked_at',
    ],
    none: ['channel_kind'],
  },
  messaging_messages: {
    identifier: ['id', 'channel_id', 'author_actor_id', 'reply_to_message_id'],
    personal: ['text'],
    none: [
      'sequence',
      'change_version',
      'created_at',
      'edited_at',
      'removed_at',
    ],
  },
  messaging_receipts: {
    identifier: ['channel_id', 'request_id', 'message_id'],
    personal: ['actor_id', 'payload_digest'],
    none: [],
  },
  messaging_reactions: {
    identifier: ['channel_id', 'message_id'],
    personal: ['actor_id', 'reaction'],
    none: [],
  },
} as const;

export const messagingPrivacyExpectedColumns = Object.fromEntries(
  Object.entries(messagingColumns).map(([table, groups]) => [
    table,
    Object.values(groups).flat(),
  ]),
);

/** Pending proposals carry no collection, legal-basis or retention authority. */
export const messagingPrivacyFields: readonly PrivacyFieldDeclaration[] =
  Object.entries(messagingColumns).flatMap(([table, groups]) =>
    Object.entries(groups).flatMap(([category, columns]) =>
      columns.map((column: string) => ({
        table,
        column,
        category: category as 'identifier' | 'personal' | 'none',
        ...(category === 'personal' ? { visibility: 'private' as const } : {}),
        storage: 'postgres' as const,
        owner: 'MSG',
        purpose:
          category === 'personal'
            ? 'Subject-directed private communication and social access'
            : 'Messaging references and ordered durable state',
        lawfulBasis: {
          status: 'pending' as const,
          decision: 'DEC-124 / ADR-0063',
        },
        retention: {
          status: 'pending' as const,
          decision: 'DEC-124 / ADR-0063',
        },
        erasure:
          category === 'personal'
            ? ('delete' as const)
            : ('retain-nonpersonal' as const),
        exportable: true,
      })),
    ),
  );
