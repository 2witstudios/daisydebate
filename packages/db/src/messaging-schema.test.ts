import { assert, setupRitewayBun, test } from 'riteway/bun';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  messagingChannels,
  messagingActorStates,
} from './schema/messaging-channels';
import {
  messagingContactPairs,
  messagingGroupInvitations,
  messagingSocialCommands,
  messagingDmPairs,
  messagingGroupGrants,
} from './schema/messaging-social';
import {
  messagingMessages,
  messagingReceipts,
  messagingReactions,
} from './schema/messaging-messages';

setupRitewayBun();

test('social channels use constrained identity rather than preference grants', () => {
  assert({
    given: 'actor display preferences',
    should: 'contain no access role or entitlement fields',
    actual: Object.keys(
      getTableConfig(messagingActorStates).columns.reduce<Record<string, true>>(
        (fields, column) => ({ ...fields, [column.name]: true }),
        {},
      ),
    ).sort(),
    expected: [
      'actor_id',
      'channel_id',
      'following',
      'hidden',
      'notification_level',
      'read_sequence',
    ],
  });
  const pairs = getTableConfig(messagingDmPairs);
  assert({
    given: 'canonical DM pairs',
    should: 'declare canonical ordering and one channel per pair',
    actual: {
      checks: pairs.checks.map((item) => item.name).sort(),
      unique: pairs.uniqueConstraints.map((item) => item.name).sort(),
    },
    expected: {
      checks: [
        'messaging_dm_pairs_kind',
        'messaging_dm_pairs_order',
        'messaging_dm_pairs_request_sender',
        'messaging_dm_pairs_request_state',
        'messaging_dm_pairs_request_time',
      ],
      unique: ['messaging_dm_pairs_channel_unique'],
    },
  });
  assert({
    given: 'social channel schema',
    should: 'name the policy and revision and separate sequence from changes',
    actual: getTableConfig(messagingChannels)
      .columns.map((column) => column.name)
      .sort(),
    expected: [
      'authority_revision',
      'change_version',
      'created_at',
      'id',
      'kind',
      'lifecycle',
      'message_sequence',
      'policy_key',
      'policy_revision',
      'title',
      'title_author_actor_id',
    ],
  });
  assert({
    given: 'group access grants',
    should: 'bind channel kind with a composite key',
    actual: getTableConfig(messagingGroupGrants)
      .foreignKeys.map((key) => key.reference().name)
      .filter(Boolean),
    expected: ['messaging_group_grants_channel_kind_fk'],
  });
});

test('message references and idempotency cannot cross channels', () => {
  for (const [table, name] of [
    [messagingMessages, 'messaging_messages_reply_channel_fk'],
    [messagingReceipts, 'messaging_receipts_message_channel_fk'],
    [messagingReactions, 'messaging_reactions_message_channel_fk'],
  ] as const) {
    const key = getTableConfig(table)
      .foreignKeys.find((item) => item.reference().name === name)
      ?.reference();
    assert({
      given: name,
      should: 'include the channel in the referenced message association',
      actual: key?.foreignColumns.map((column) => column.name),
      expected: ['id', 'channel_id'],
    });
  }
  assert({
    given: 'a durable receipt',
    should: 'retain no message body for replay',
    actual: getTableConfig(messagingReceipts)
      .columns.map((column) => column.name)
      .sort(),
    expected: [
      'actor_id',
      'channel_id',
      'message_id',
      'payload_digest',
      'request_id',
    ],
  });
});

test('request and block state share a canonical pair fence and grants have generations', () => {
  const pairFields = getTableConfig(messagingDmPairs).columns.map(
    (column) => column.name,
  );
  assert({
    given: 'a DM request',
    should: 'carry explicit sender and transition state',
    actual: [
      'request_sender_actor_id',
      'request_state',
      'requested_at',
      'decided_at',
    ].every((field) => pairFields.includes(field)),
    expected: true,
  });
  assert({
    given: 'a current group grant',
    should: 'fence old invitation/authorization results by generation',
    actual: getTableConfig(messagingGroupGrants).columns.some(
      (column) => column.name === 'generation',
    ),
    expected: true,
  });
});

test('authorization versions do not depend on message activity', () => {
  assert({
    given: 'an empty channel',
    should: 'have an independent positive authority revision',
    actual: getTableConfig(messagingChannels).columns.some(
      (column) => column.name === 'authority_revision',
    ),
    expected: true,
  });
});

test('every dedicated messaging foreign key has a full leading-column index', () => {
  const tables = [
    messagingChannels,
    messagingActorStates,
    messagingContactPairs,
    messagingDmPairs,
    messagingGroupGrants,
    messagingGroupInvitations,
    messagingSocialCommands,
    messagingMessages,
    messagingReceipts,
    messagingReactions,
  ];
  const uncovered = tables.flatMap((table) => {
    const config = getTableConfig(table);
    const keys = [
      ...config.primaryKeys.map((key) =>
        key.columns.map((column) => column.name),
      ),
      ...config.uniqueConstraints.map((key) =>
        key.columns.map((column) => column.name),
      ),
      ...config.columns
        .filter((column) => column.primary || column.isUnique)
        .map((column) => [column.name]),
      ...config.indexes
        .filter((index) => index.config.where === undefined)
        .map((index) =>
          index.config.columns.map((column) =>
            'name' in column ? column.name : null,
          ),
        ),
    ];
    return config.foreignKeys
      .filter(
        (key) =>
          !keys.some((index) =>
            key
              .reference()
              .columns.every(
                (column, position) => index[position] === column.name,
              ),
          ),
      )
      .map(
        (key) =>
          `${config.name}:${key
            .reference()
            .columns.map((column) => column.name)
            .join(',')}`,
      );
  });
  assert({
    given: 'all foreign keys of all dedicated messaging tables',
    should:
      'declare an unconditional index with exactly matching leading columns',
    actual: uncovered,
    expected: [],
  });
});
