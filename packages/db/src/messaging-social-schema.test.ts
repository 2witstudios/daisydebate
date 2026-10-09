import { assert, setupRitewayBun, test } from 'riteway/bun';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  messagingGroupInvitations,
  messagingSocialCommands,
  messagingDmPairs,
} from './schema/messaging-social';
import { messagingReceipts } from './schema/messaging-messages';
setupRitewayBun();
test('social command receipts and invitations persist private authority transitions without granting history', () => {
  assert({
    given: 'an unavailable consumed send',
    should: 'permit fingerprint removal while preserving the request identity',
    actual: messagingReceipts.payloadDigest.notNull,
    expected: false,
  });
  assert({
    given: 'a pending DM introduction',
    should:
      'store only an optional introduction beside its real request authority',
    actual: messagingDmPairs.introduction.notNull,
    expected: false,
  });
  assert({
    given: 'a private group invitation',
    should:
      'bind invitee and inviter with a positive generation and lifecycle constraints',
    actual: getTableConfig(messagingGroupInvitations)
      .columns.map((column) => column.name)
      .sort(),
    expected: [
      'channel_id',
      'channel_kind',
      'decided_at',
      'generation',
      'invited_at',
      'invited_by_actor_id',
      'invitee_actor_id',
      'state',
    ],
  });
  assert({
    given: 'social commands that can precede a channel',
    should:
      'keep dedupe separate from message receipts and record durable request timing',
    actual: getTableConfig(messagingSocialCommands)
      .columns.map((column) => column.name)
      .sort(),
    expected: [
      'actor_id',
      'created_at',
      'digest',
      'kind',
      'request_id',
      'result_channel_id',
    ],
  });
});
