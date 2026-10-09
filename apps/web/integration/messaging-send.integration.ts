import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { createDatabase } from '@daisy/db';
import { createMessagingTestFixture } from '@daisy/db/testing';
import { requireTestServices } from '@daisy/config';
import { socialPolicyEvidence } from '@daisy/auth/social-policy';
import { messagingAuthorizationFence } from '../src/features/messaging/authorization-fence';
import { sendMessagingMessage } from '../src/features/messaging/send';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('composed messaging sends dedupe races and refuse protected replay after blocking', async () => {
  const client = new SQL(databaseUrl);
  const fixture = await createMessagingTestFixture(client);
  const database = createDatabase({ url: databaseUrl, nextActorId: createId });
  const principal = {
    kind: 'user' as const,
    userId: fixture.userId,
    actorId: fixture.actorId,
  };
  const clock = { now: () => fixture.now };
  const store = database.messagingChannelStore(
    messagingAuthorizationFence({
      principal,
      capability: 'channel.post',
      clock,
      postingPolicy: {
        state: 'approved',
        decision: 'Explicit integration fixture only',
        key: 'social.dm',
        revision: 1,
        allowedBandPairs: [['adult', 'adult']],
      },
      readingPolicy: (input) => ({
        ...socialPolicyEvidence(input.channel, input.accounts, input.now),
        allowed: true,
      }),
    }),
  );
  const dependencies = {
    store,
    clock,
    ids: { next: createId },
    bounds: { messageUnits: 100, pageItems: 20 },
    limit: async () => {},
  };
  const command = {
    version: 1,
    channelId: fixture.channelId,
    requestId: createId(),
    text: 'One durable message',
  };
  const snapshot = async () => {
    const [row] = await client.unsafe(
      `select message_sequence::int as sequence,change_version::int as version,
      (select count(*)::int from messaging_messages where channel_id=$1) as messages,
      (select count(*)::int from messaging_receipts where channel_id=$1) as receipts,
      (select count(*)::int from outbox where payload->>'channelId'=$1) as bells
      from messaging_channels where id=$1`,
      [fixture.channelId],
    );
    return row;
  };
  try {
    const [first, retry] = await Promise.all([
      sendMessagingMessage(command, principal, dependencies),
      sendMessagingMessage(command, principal, dependencies),
    ]);
    assert({
      given: 'two concurrent sends with the same actor/channel/request/payload',
      should: 'commit one message and one receipt/version/doorbell',
      actual: { sameId: first.id === retry.id, state: await snapshot() },
      expected: {
        sameId: true,
        state: { sequence: 1, version: 1, messages: 1, receipts: 1, bells: 1 },
      },
    });
    const before = await snapshot();
    await assertRejects({
      given: 'a different payload under the same request key',
      should: 'conflict without another mutation',
      actual: () =>
        sendMessagingMessage(
          { ...command, text: 'Different' },
          principal,
          dependencies,
        ),
      code: 'CONFLICT',
    });
    await assertRejects({
      given: 'a limiter refusal after authorization and plan preparation',
      should: 'roll back without allocating durable state',
      actual: () =>
        sendMessagingMessage({ ...command, requestId: createId() }, principal, {
          ...dependencies,
          limit: async () => {
            throw createAppError('RATE_LIMIT');
          },
        }),
      code: 'RATE_LIMIT',
    });
    assert({
      given: 'refused conflicting replay and limiter failure',
      should: 'preserve mutation counts and ordered cursors',
      actual: await snapshot(),
      expected: before,
    });
    await client.unsafe(
      'update messaging_contact_pairs set low_blocks_high=true,revision=revision+1 where low_actor_id=$1 and high_actor_id=$2',
      [fixture.low, fixture.high],
    );
    await assertRejects({
      given:
        'a previously accepted request retried after current bilateral blocking',
      should: 'deny before revealing the stored message',
      actual: () => sendMessagingMessage(command, principal, dependencies),
      code: 'AUTHORIZATION',
    });
    assert({
      given: 'a blocked protected replay',
      should: 'leave message/receipt/counters/outbox unchanged',
      actual: await snapshot(),
      expected: before,
    });
  } finally {
    await fixture.cleanup();
    await database.close();
    await client.close();
  }
});
