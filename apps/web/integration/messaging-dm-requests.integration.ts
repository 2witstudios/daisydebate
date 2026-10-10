import { buildUserInboxTopic } from '@daisy/protocol';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { openMessagingParticipants } from './messaging-fixture.test-support';
import {
  messagingFixturePosting,
  messagingFixtureReading,
} from './messaging-policy.test-support';
import { composeMessagingDmStore } from '../src/features/messaging/dm-composition';
import { decideMessagingDm } from '../src/features/messaging/decide-request';
import { messagingAuthorizationFence } from '../src/features/messaging/authorization-fence';
import { sendMessagingMessage } from '../src/features/messaging/send';
import { blockMessagingContact } from '../src/features/messaging/block';
import { messagingSocialAuthorizationFence } from '../src/features/messaging/social-authorization';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const bounds = { introductionUnits: 100, titleUnits: 80, batchActors: 10 };

test('real DM recipient accept opens history/post and binds closed retry through independent reading authority', async () => {
  const { client, database, fixture, sender, recipient } =
    await openMessagingParticipants(databaseUrl);
  const clock = { now: () => fixture.now };
  const requestId = createId();
  const dmStore = (principal: typeof sender) =>
    composeMessagingDmStore({
      database,
      principal,
      clock,
      postingPolicy: messagingFixturePosting,
      readingPolicy: messagingFixtureReading,
    });
  const dependencies = {
    store: dmStore(recipient),
    bounds,
    clock,
    limit: async () => {},
  };
  const command = {
    version: 1,
    channelId: fixture.channelId,
    requestId,
    decision: 'accept',
  };
  const send = () =>
    sendMessagingMessage(
      {
        version: 1,
        channelId: fixture.channelId,
        requestId: createId(),
        text: 'Accepted private text',
      },
      sender,
      {
        bounds: { messageUnits: 100, pageItems: 20 },
        clock,
        ids: { next: createId },
        limit: async () => {},
        store: database.messagingChannelStore(
          messagingAuthorizationFence({
            principal: sender,
            clock,
            capability: 'channel.post',
            postingPolicy: messagingFixturePosting,
            readingPolicy: messagingFixtureReading,
          }),
        ),
      },
    );
  try {
    await client.unsafe(
      "update messaging_dm_pairs set request_state='pending', decided_at=null, introduction='Private introduction' where channel_id=$1",
      [fixture.channelId],
    );
    await assertRejects({
      given: 'a pending DM request',
      should: 'refuse ordinary message posting',
      actual: send,
      code: 'AUTHORIZATION',
    });
    const preview = await dmStore(recipient).withChannel(
      { ...recipient, channelId: fixture.channelId },
      (frame) => frame.readRequest(),
    );
    await assertRejects({
      given: 'the request sender using the recipient preview grant',
      should: 'conceal the pending introduction route',
      actual: () =>
        dmStore(sender).withChannel(
          { ...sender, channelId: fixture.channelId },
          (frame) => frame.readRequest(),
        ),
      code: 'NOT_FOUND',
    });
    const result = await decideMessagingDm(command, recipient, dependencies);
    const message = await send();
    await blockMessagingContact(
      {
        version: 1,
        requestId: createId(),
        otherActorId: recipient.actorId,
        blocked: true,
      },
      sender,
      {
        bounds,
        clock,
        limit: async () => {},
        store: database.messagingSocialStore(
          messagingSocialAuthorizationFence({
            principal: sender,
            clock,
            operation: { kind: 'block' },
          }),
        ),
      },
    );
    const retry = await decideMessagingDm(command, recipient, dependencies);
    await assertRejects({
      given: 'an accepted but now blocked DM',
      should:
        'deny a new send while preserving separately authorized own receipt result',
      actual: send,
      code: 'AUTHORIZATION',
    });
    const [counts] = await client.unsafe(
      'select (select count(*)::int from messaging_social_commands where actor_id=$1 and request_id=$2) as receipts,(select count(*)::int from messaging_messages where channel_id=$3) as messages',
      [recipient.actorId, requestId, fixture.channelId],
    );
    assert({
      given: 'actual request preview, accept, post, block and closed retry',
      should: 'preserve one bound result/write and the accepted message',
      actual: [preview.introduction, result, retry, message.text, counts],
      expected: [
        'Private introduction',
        { channelId: fixture.channelId, state: 'accepted' },
        { channelId: fixture.channelId, state: 'accepted' },
        'Accepted private text',
        { receipts: 1, messages: 1 },
      ],
    });
    const bells = await client.unsafe(
      "select payload from outbox where kind='messaging.inbox.changed' and topic in ($1,$2) order by txid,seq",
      [
        buildUserInboxTopic(sender.actorId),
        buildUserInboxTopic(recipient.actorId),
      ],
    );
    assert({
      given: 'committed accept and block authority changes',
      should:
        'invalidate both own inboxes without channel IDs or request content',
      actual: bells.map((row: { payload: Record<string, unknown> }) =>
        Object.keys(row.payload).sort(),
      ),
      expected: Array.from({ length: 4 }, () => ['kind']),
    });
    await fixture.eraseSubject(sender.actorId);
    await assertRejects({
      given: 'counterpart erasure removed pair and receipt association',
      should: 'refuse the same result without reconstructing authority',
      actual: () => decideMessagingDm(command, recipient, dependencies),
      code: 'NOT_FOUND',
    });
  } finally {
    await fixture.cleanup();
    await database.close();
    await client.close();
  }
});

for (const decision of ['decline', 'cancel'] as const) {
  test(`real pending ${decision} requires its distinct caller and commits only once`, async () => {
    const { client, database, fixture, sender, recipient } =
      await openMessagingParticipants(databaseUrl);
    const clock = { now: () => fixture.now };
    const allowed = decision === 'cancel' ? sender : recipient;
    const denied = decision === 'cancel' ? recipient : sender;
    const command = {
      version: 1,
      channelId: fixture.channelId,
      requestId: createId(),
      decision,
    };
    const dependencies = (principal: typeof sender) => ({
      bounds,
      clock,
      limit: async () => {},
      store: composeMessagingDmStore({
        database,
        principal,
        clock,
        postingPolicy: messagingFixturePosting,
        readingPolicy: messagingFixtureReading,
      }),
    });
    try {
      await client.unsafe(
        "update messaging_dm_pairs set request_state='pending',decided_at=null where channel_id=$1",
        [fixture.channelId],
      );
      await assertRejects({
        given: 'the wrong participant for this pending action',
        should: 'refuse before changing lifecycle or creating a receipt',
        actual: () => decideMessagingDm(command, denied, dependencies(denied)),
        code: 'AUTHORIZATION',
      });
      const first = await decideMessagingDm(
        command,
        allowed,
        dependencies(allowed),
      );
      const replay = await decideMessagingDm(
        command,
        allowed,
        dependencies(allowed),
      );
      assert({
        given: 'a valid pending decision and identical protected retry',
        should: 'return the same minimal closed result',
        actual: [first, replay],
        expected: Array(2).fill({
          channelId: fixture.channelId,
          state: decision === 'cancel' ? 'cancelled' : 'declined',
        }),
      });
    } finally {
      await fixture.cleanup();
      await database.close();
      await client.close();
    }
  });
}
