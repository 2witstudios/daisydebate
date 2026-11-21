import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMessagingStore } from '../src/messaging/store';
import { createMessagingTestFixture } from '../src/testing';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('the native mutation frame preserves identity and refuses invalid or unauthorized writes', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const { actorId, otherActorId, userId, channelId, now } = fixture;
  const scope = { actorId, userId, channelId };
  const original = createId();
  const foreign = createId();
  const editedAt = new Date(Date.parse(now) + 1000).toISOString();
  const statements: string[] = [];
  const database = drizzle({
    client,
    logger: { logQuery: (query) => statements.push(query.trim()) },
  });
  let fences = 0;
  const store = createMessagingStore({
    database,
    authorize: async () => {
      fences++;
    },
  });
  const denied = createMessagingStore({
    database,
    authorize: async () => {
      throw createAppError('AUTHORIZATION');
    },
  });
  const make = (kind: 'edit' | 'remove', messageId: string) => {
    const scope = {
      version: 1 as const,
      channelId,
      messageId,
      requestId: createId(),
    };
    return kind === 'edit'
      ? { ...scope, kind, text: 'Edited proof' }
      : { ...scope, kind };
  };
  const originalMessage = {
    id: original,
    channelId,
    authorActorId: actorId,
    sequence: 1,
    changeVersion: 1,
    text: 'Original proof',
    createdAt: now,
    editedAt: null,
    removedAt: null,
  };
  const removePlan = {
    message: {
      ...originalMessage,
      text: null,
      removedAt: editedAt,
      changeVersion: 4,
    },
    payloadDigest: 'd'.repeat(64),
  };
  try {
    await client`update messaging_channel_streams set message_sequence=2,change_version=2 where channel_id=${channelId}`;
    await client`insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at) values(${original},${channelId},${actorId},1,1,'Original proof',${now}),(${foreign},${channelId},${otherActorId},2,2,'Other proof',${now})`;
    await assertRejects({
      given: 'fresh mutation denial',
      should: 'withhold message and receipt reads',
      actual: () =>
        denied.withChannel(scope, (frame) =>
          frame.readMutationState(make('remove', original)),
        ),
      code: 'AUTHORIZATION',
    });
    assert({
      given: 'the refusal at the real authority fence',
      should: 'issue no message or receipt SQL',
      actual: statements.some((query) =>
        /messaging_(messages|receipts)\b/.test(query),
      ),
      expected: false,
    });
    const edit = make('edit', original);
    fences = 0;
    const state = await store.withChannel(scope, async (frame) => {
      const plan = {
        message: {
          ...originalMessage,
          text: 'Edited proof',
          editedAt,
          changeVersion: 3,
        },
        payloadDigest: 'a'.repeat(64),
      };
      await assertRejects({
        given: 'a plan without protected observation',
        should: 'refuse committing it',
        actual: () => frame.commitMutation(plan),
        code: 'CONFLICT',
      });
      const read = await frame.readMutationState(edit);
      await assertRejects({
        given: 'an observed edit changing immutable sequence',
        should: 'refuse that plan',
        actual: () =>
          frame.commitMutation({
            ...plan,
            message: { ...plan.message, sequence: 99 },
          }),
        code: 'CONFLICT',
      });
      await frame.commitMutation(plan);
      return [read.message, frame.counters];
    });
    assert({
      given: 'an admitted edit of a real message',
      should:
        'read the original and advance the change counter only after all fences',
      actual: [state, fences],
      expected: [
        [originalMessage, { channelId, messageSequence: 2, changeVersion: 3 }],
        4,
      ],
    });
    const remove = make('remove', original);
    await store.withChannel(scope, async (frame) => {
      await frame.readMutationState(remove);
      await frame.commitMutation(removePlan);
    });
    for (const id of [original, foreign, createId()]) {
      statements.length = 0;
      await store.withChannel(scope, async (frame) => {
        await frame.readMutationState(make('remove', id));
        await assertRejects({
          given: 'a removed, foreign, or absent message',
          should: 'refuse write after scoped discovery',
          actual: () =>
            frame.commitMutation({
              ...removePlan,
              message: { ...removePlan.message, id },
            }),
          code: 'CONFLICT',
        });
      });
      assert({
        given: 'the rejected durable message mutation',
        should: 'make no durable writes',
        actual: statements.some((query) =>
          /^(insert|update|delete)\b/.test(query),
        ),
        expected: false,
      });
    }
    const [stored] =
      await client`select sequence::int as sequence,change_version::int as version,text,created_at,removed_at,(select count(*)::int from messaging_receipts where channel_id=${channelId} and payload_digest is not null) as fingerprints,(select count(*)::int from outbox where topic=${`channel:${channelId}`}) as bells from messaging_messages where id=${original}`;
    assert({
      given: 'the stored edit and removal',
      should:
        'preserve creation and sequence, scrub the content and both receipt digests, and emit no channel doorbell',
      actual: [
        stored?.sequence,
        stored?.version,
        stored?.text,
        stored?.created_at?.toISOString(),
        stored?.removed_at?.toISOString(),
        stored?.fingerprints,
        stored?.bells,
      ],
      expected: [1, 4, null, now, editedAt, 0, 0],
    });
  } finally {
    await fixture.cleanup();
    await client.close();
  }
});
