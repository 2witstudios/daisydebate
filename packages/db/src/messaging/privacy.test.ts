import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { createMessagingPrivacyAdopter } from './privacy';
setupRitewayBun();
const actorId = 'a'.repeat(24),
  peerId = 'b'.repeat(24),
  channelId = 'c'.repeat(24);
const subject = { actorId, userId: 'u'.repeat(24) },
  now = '2026-10-09T18:00:00.000Z';
test('subject export removes other-direction private state and serializes dates/charges through the actual sole file adopter', async () => {
  const date = new Date(now);
  const { client, queries } = fakeSql([
    [],
    [],
    [{ id: 'm'.repeat(24), author_actor_id: actorId, created_at: date }],
    [],
    [],
    [],
    [],
    [
      {
        low_actor_id: actorId,
        high_actor_id: peerId,
        revision: 1,
        low_blocks_high: true,
        high_blocks_low: true,
      },
      {
        low_actor_id: '0'.repeat(24),
        high_actor_id: actorId,
        revision: 2,
        low_blocks_high: true,
        high_blocks_low: false,
      },
    ],
    [
      { request_sender_actor_id: actorId, introduction: 'Own intro' },
      { request_sender_actor_id: peerId, introduction: 'Other intro' },
    ],
    [],
    [{ actor_id: peerId, subject_actor_id: actorId }],
    [
      {
        invitee_actor_id: actorId,
        invited_by_actor_id: peerId,
        state: 'declined',
        decided_at: date,
      },
      {
        invitee_actor_id: peerId,
        invited_by_actor_id: actorId,
        state: 'declined',
        decided_at: date,
      },
    ],
    [],
    [
      {
        id: 'f'.repeat(24),
        filename: 'Own file',
        reserved_bytes: 2n,
        created_at: date,
      },
    ],
  ]);
  const result = await createMessagingPrivacyAdopter().export(
    drizzle({ client }),
    subject,
  );
  assert({
    given: 'own and other-direction request/block/invitation facts',
    should:
      'export only own private decisions and explicit UTC JSON values with title attribution',
    actual: [
      result.messaging_channels,
      result.messaging_messages,
      result.messaging_contact_pairs,
      result.messaging_dm_pairs,
      result.messaging_group_invitations,
      result.messaging_files,
    ],
    expected: [
      [],
      [{ id: 'm'.repeat(24), author_actor_id: actorId, created_at: now }],
      [
        {
          low_actor_id: actorId,
          high_actor_id: peerId,
          revision: 1,
          low_blocks_high: true,
        },
        {
          low_actor_id: '0'.repeat(24),
          high_actor_id: actorId,
          revision: 2,
          high_blocks_low: false,
        },
      ],
      [
        { request_sender_actor_id: actorId, introduction: 'Own intro' },
        { request_sender_actor_id: peerId },
      ],
      [
        {
          invitee_actor_id: actorId,
          invited_by_actor_id: peerId,
          state: 'declined',
          decided_at: now,
        },
        { invitee_actor_id: peerId, invited_by_actor_id: actorId },
      ],
      [
        {
          id: 'f'.repeat(24),
          filename: 'Own file',
          reserved_bytes: 2,
          created_at: now,
        },
      ],
    ],
  });
  const fileQuery = queries.at(-1);
  assert({
    given: 'the dedicated export projections',
    should:
      'bind every query to subject and keep opaque storage key outside the file projection',
    actual: [
      queries.every((query) => query.params.includes(actorId)),
      fileQuery?.query.includes('object_key'),
      queries[1]?.query.includes('messaging_files'),
      queries[1]?.query.includes('messaging_social_command_subjects'),
    ],
    expected: [true, false, true, true],
  });
});
test('erasure fences every subject channel before file cleanup and publishes final combined content-free version', async () => {
  const { client, queries } = fakeSql([
    [],
    [],
    [
      { id: 'm'.repeat(24), channelId, authorActorId: actorId },
      { id: 'n'.repeat(24), channelId, authorActorId: peerId },
    ],
    [{ changeVersion: 2 }],
    [],
    [{ changeVersion: 3 }],
    [],
    [],
    [],
    [],
    [{ channelId }],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [{ changeVersion: 4 }],
    [[1, '9']],
    [],
  ]);
  const adopter = createMessagingPrivacyAdopter();
  await adopter.erase(drizzle({ client }), subject, { now });
  const channelUpdates = queries.filter((query) =>
    query.query.includes('authority_revision=authority_revision+'),
  );
  const messageUpdates = queries.filter((query) =>
    query.query.startsWith('\n      update messaging_messages'),
  );
  const bells = queries.filter((query) =>
    query.query.startsWith('insert into "outbox"'),
  );
  assert({
    given:
      'own content and peer message with subject reaction plus authority association',
    should:
      'scrub only own text and combine authority advance into one latest bell after all cleanup',
    actual: [
      adopter.phase,
      channelUpdates.map((query) => query.params[0]),
      messageUpdates.length,
      bells.length,
      bells[0]?.params.find(
        (value) => typeof value === 'object' && value !== null,
      ),
    ],
    expected: [
      'before-auth',
      [0, 0, 1],
      2,
      1,
      { kind: 'channel.changed', channelId, changeVersion: 4 },
    ],
  });
  const fileIntent = queries.findIndex((query) =>
    query.query.includes('insert into messaging_file_deletion_intents'),
  );
  const receiptDelete = queries.find((query) =>
    query.query.includes('delete from messaging_receipts'),
  );
  assert({
    given: 'subject association cleanup',
    should:
      'hold complete channel union first, transfer opaque charge before deleting files and delete receipt identity outright',
    actual: [
      fileIntent > 1,
      queries[1]?.query.includes('order by id for update'),
      queries[fileIntent + 1]?.query.includes('delete from messaging_files'),
      receiptDelete?.params,
    ],
    expected: [true, true, true, [actorId]],
  });
});
test('exhausted erase version refuses before association or file deletion', async () => {
  const { client, queries } = fakeSql([
    [],
    [],
    [{ id: 'm'.repeat(24), channelId, authorActorId: actorId }],
    [],
  ]);
  await assertRejects({
    given: 'a channel unable to advance current version',
    should:
      'refuse erasure mutation without proceeding to file or receipt deletion',
    actual: () =>
      createMessagingPrivacyAdopter().erase(drizzle({ client }), subject, {
        now,
      }),
    code: 'CONFLICT',
  });
  assert({
    given: 'the refusal',
    should: 'stop before destructive association steps',
    actual: queries.some((query) => query.query.includes('delete from')),
    expected: false,
  });
});
