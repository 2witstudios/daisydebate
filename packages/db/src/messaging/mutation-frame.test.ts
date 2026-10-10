import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { channelMutationFrame } from './mutation-frame';
setupRitewayBun();
const channelId = 'c'.repeat(24),
  actorId = 'a'.repeat(24),
  messageId = 'm'.repeat(24),
  requestId = 'r'.repeat(24);
const createdAt = '2026-10-09T18:00:00.000Z',
  changedAt = '2026-10-09T18:01:00.000Z';
const original = {
  id: messageId,
  channelId,
  authorActorId: actorId,
  sequence: 2,
  changeVersion: 3,
  text: 'Original own content',
  createdAt,
  editedAt: null,
  removedAt: null,
};
for (const kind of ['edit', 'remove'] as const)
  test(`own ${kind} transaction keeps sequence and creation time while advancing only changes`, async () => {
    const steps =
      kind === 'remove'
        ? [[], [], [], [], [], [], [[1, '7']], []]
        : [[], [], [], [], [[1, '7']], []];
    const { client, queries } = fakeSql(steps);
    let fences = 0;
    const counters = { channelId, messageSequence: 2, changeVersion: 3 };
    const frame = channelMutationFrame(
      drizzle({ client }),
      { channelId, actorId },
      counters,
      async () => {
        fences += 1;
      },
      async () => original,
    );
    const command =
      kind === 'edit'
        ? {
            version: 1 as const,
            kind,
            channelId,
            requestId,
            messageId,
            text: 'Updated own content',
          }
        : { version: 1 as const, kind, channelId, requestId, messageId };
    const message = {
      ...original,
      text: kind === 'remove' ? null : 'Updated own content',
      changeVersion: 4,
      editedAt: kind === 'edit' ? changedAt : null,
      removedAt: kind === 'remove' ? changedAt : null,
    };
    const plan = {
      message,
      payloadDigest: 'd'.repeat(64),
      doorbell: {
        kind: 'channel.changed' as const,
        channelId,
        changeVersion: 4,
      },
    };
    await assertRejects({
      given: 'a mutation plan before protected observation',
      should: 'refuse unbound writes',
      actual: () => frame.commitMutation(plan),
      code: 'CONFLICT',
    });
    const state = await frame.readMutationState(command);
    await assertRejects({
      given: 'a plan changing immutable sequence',
      should: 'refuse without mutating receipt or message',
      actual: () =>
        frame.commitMutation({ ...plan, message: { ...message, sequence: 9 } }),
      code: 'CONFLICT',
    });
    await frame.commitMutation(plan);
    assert({
      given: `the freshly authorized own ${kind}`,
      should: 'preserve creation/sequence and recheck every protected boundary',
      actual: [state.message, counters, fences],
      expected: [
        original,
        { channelId, messageSequence: 2, changeVersion: 4 },
        4,
      ],
    });
    const receipt = queries.find((query) =>
      query.query.startsWith('insert into "messaging_receipts"'),
    );
    assert({
      given: 'persisted content removal or edit',
      should:
        'scrub remove digests and file metadata without deleting physical objects before acknowledgement',
      actual: [
        receipt?.params.includes('d'.repeat(64)),
        queries.some((query) =>
          query.query.startsWith('update "messaging_files"'),
        ),
        queries.some((query) => query.query.startsWith('delete')),
        queries.filter((query) =>
          query.query.startsWith('insert into "outbox"'),
        ).length,
      ],
      expected: [kind === 'edit', kind === 'remove', false, 1],
    });
  });
for (const stored of [
  null,
  { ...original, authorActorId: 'b'.repeat(24) },
  { ...original, text: null, removedAt: changedAt },
])
  test(`mutation refuses absent/foreign/removed message ${stored?.authorActorId} ${stored?.removedAt}`, async () => {
    const { client, queries } = fakeSql([[]]);
    const frame = channelMutationFrame(
      drizzle({ client }),
      { channelId, actorId },
      { channelId, messageSequence: 2, changeVersion: 3 },
      async () => {},
      async () => stored,
    );
    await frame.readMutationState({
      version: 1,
      kind: 'remove',
      channelId,
      requestId,
      messageId,
    });
    await assertRejects({
      given: 'an absent, other-author or already removed message',
      should: 'refuse mutation without durable writes',
      actual: () =>
        frame.commitMutation({
          message: {
            ...original,
            text: null,
            removedAt: changedAt,
            changeVersion: 4,
          },
          payloadDigest: 'd'.repeat(64),
          doorbell: { kind: 'channel.changed', channelId, changeVersion: 4 },
        }),
      code: 'CONFLICT',
    });
    assert({
      given: 'the rejected mutation',
      should: 'only read its scoped receipt',
      actual: queries.map((query) => query.query.split(' ')[0]),
      expected: ['select'],
    });
  });
test('fresh mutation refusal precedes message and receipt discovery', async () => {
  const { client, queries } = fakeSql([]);
  let reads = 0;
  const frame = channelMutationFrame(
    drizzle({ client }),
    { channelId, actorId },
    { channelId, messageSequence: 2, changeVersion: 3 },
    async () => {
      throw createAppError('AUTHORIZATION');
    },
    async () => {
      reads += 1;
      return original;
    },
  );
  await assertRejects({
    given: 'fresh own removal authority loss',
    should: 'refuse before reading text or receipt',
    actual: () =>
      frame.readMutationState({
        version: 1,
        kind: 'remove',
        channelId,
        requestId,
        messageId,
      }),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'refusal',
    should: 'leave message port and driver untouched',
    actual: [reads, queries.length],
    expected: [0, 0],
  });
});
