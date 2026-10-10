import type { PrivacyFieldDeclaration } from './contracts';

/** Dedicated MSG schema inputs include file source b493460b and F4 source f589971c. */
const messagingColumns = {
  messaging_channels: {
    identifier: ['id'],
    personal: ['title', 'title_author_actor_id'],
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
      'introduction',
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
  messaging_social_commands: {
    identifier: ['request_id'],
    personal: [
      'actor_id',
      'counterpart_actor_id',
      'digest',
      'result_channel_id',
    ],
    none: ['kind', 'created_at'],
  },
  messaging_group_invitations: {
    identifier: [],
    personal: [
      'channel_id',
      'invitee_actor_id',
      'invited_by_actor_id',
      'generation',
      'state',
      'invited_at',
      'decided_at',
    ],
    none: ['channel_kind'],
  },
  messaging_social_command_subjects: {
    identifier: [],
    personal: ['actor_id', 'request_id', 'subject_actor_id'],
    none: [],
  },
  messaging_reactions: {
    identifier: ['channel_id', 'message_id'],
    personal: ['actor_id', 'reaction'],
    none: [],
  },
  messaging_files: {
    identifier: ['id', 'object_key'],
    personal: [
      'channel_id',
      'owner_actor_id',
      'request_id',
      'message_id',
      'filename',
      'mime',
      'reserved_bytes',
      'stored_bytes',
    ],
    none: [
      'generation',
      'authority_revision',
      'lifecycle',
      'created_at',
      'expires_at',
      'deleted_at',
    ],
  },
  messaging_file_deletion_intents: {
    identifier: ['object_key'],
    personal: [],
    none: ['charged_bytes'],
  },
} as const;

export const messagingPrivacyExpectedColumns = Object.fromEntries(
  Object.entries(messagingColumns).map(([table, groups]) => [
    table,
    Object.values(groups).flat(),
  ]),
);

type MessagingPrivacyCategory = 'identifier' | 'personal' | 'none';

function privacyPurpose(
  table: string,
  column: string,
  category: MessagingPrivacyCategory,
): string {
  if (table === 'messaging_files' && column === 'object_key') {
    return 'Internal vendor object deletion routing';
  }
  if (table === 'messaging_file_deletion_intents') {
    return column === 'object_key'
      ? 'Internal vendor object deletion routing'
      : 'Unlinked charged deletion accounting';
  }
  if (table === 'messaging_files') {
    return 'Private attachment metadata and quota reservation';
  }
  if (category === 'personal') {
    return 'Subject-directed private communication and social access';
  }
  return 'Messaging references and ordered durable state';
}

function privacyErasure(
  table: string,
  column: string,
  category: MessagingPrivacyCategory,
): 'scrub' | 'delete' | 'retain-nonpersonal' {
  if (table === 'messaging_messages' && column === 'text') return 'scrub';
  if (table === 'messaging_files') return 'delete';
  if (category === 'personal') return 'delete';
  if (
    (table === 'messaging_files' && column === 'object_key') ||
    (table === 'messaging_file_deletion_intents' && column === 'object_key')
  )
    return 'delete';
  return 'retain-nonpersonal';
}

/** Pending proposals carry no collection, legal-basis or retention authority. */
export const messagingPrivacyFields: readonly PrivacyFieldDeclaration[] =
  Object.entries(messagingColumns).flatMap(([table, groups]) =>
    Object.entries(groups).flatMap(([category, columns]) =>
      columns.map((column: string) => ({
        table,
        column,
        category: category as MessagingPrivacyCategory,
        ...(category === 'personal' ||
        ((table === 'messaging_files' ||
          table === 'messaging_file_deletion_intents') &&
          column === 'object_key')
          ? { visibility: 'private' as const }
          : {}),
        storage: 'postgres' as const,
        owner: 'MSG',
        purpose: privacyPurpose(
          table,
          column,
          category as MessagingPrivacyCategory,
        ),
        lawfulBasis: {
          status: 'pending' as const,
          decision: 'jc0qcdvpkmqzrelpaesi3pah',
        },
        retention: {
          status: 'pending' as const,
          decision: 'njiorsf64z4iqjm2dbfa3zuu',
        },
        erasure: privacyErasure(
          table,
          column,
          category as MessagingPrivacyCategory,
        ),
        exportable: !(
          ((table === 'messaging_files' ||
            table === 'messaging_file_deletion_intents') &&
            column === 'object_key') ||
          table === 'messaging_file_deletion_intents'
        ),
      })),
    ),
  );
