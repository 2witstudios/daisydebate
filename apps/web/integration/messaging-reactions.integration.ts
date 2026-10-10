import { z } from 'zod';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { origin } from './fixtures';
import * as mountedMessaging from './messaging-route.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('mounted reactions retain current aggregates, replay immutability and own cleanup under posting revocation', async () => {
  const fixture = await mountedMessaging.mountedMessagingPair(databaseUrl, {
    messagingPolicy: {
      ...mountedMessaging.messagingRoutePolicy,
      reactions: { reactionUnits: 8, choices: ['👍', '❤️'] },
    },
  });
  const { app, first, second, me, peer, client, channelId, routes } = fixture;
  try {
    await mountedMessaging.seedMessagingRouteDm(
      client,
      me,
      peer,
      channelId,
      app.app.clock.now(),
    );
    const sent = await routes.messaging.send(
      app.jsonPost(
        '/api/messaging/messages',
        {
          version: 1,
          channelId,
          requestId: createId(),
          text: 'Current scoped reaction contribution',
        },
        { cookie: first.cookie },
      ),
    );
    const message = await sent.json();
    if (sent.status !== 200 || typeof message.id !== 'string')
      throw new Error('Actual authored message required');
    const command = {
      version: 1,
      channelId,
      messageId: message.id,
      requestId: createId(),
      reaction: '👍',
      active: true,
    };
    const change = (cookie: string, body: unknown) =>
      routes.messaging.reactions(
        app.jsonPost('/api/messaging/reactions', body, { cookie }),
      );
    const read = (cookie: string, id = channelId) =>
      routes.messaging.reactions(
        new Request(
          `${origin}/api/messaging/channels/${id}/reactions?messageId=${message.id}`,
          { headers: { cookie } },
        ),
        id,
      );
    const added = await change(first.cookie, command);
    const repeated = await change(first.cookie, command);
    const collided = await change(first.cookie, { ...command, reaction: '❤️' });
    const peerAdded = await change(second.cookie, {
      ...command,
      requestId: createId(),
    });
    const summary = await read(first.cookie);
    const missing = await change(first.cookie, {
      ...command,
      requestId: createId(),
      reaction: '❤️',
      active: false,
    });
    assert({
      given:
        'two real authors reacting to one scoped message with identical and conflicting retries',
      should:
        'count each own association once and refuse foreign-intent replay or an absent cleanup association',
      actual: [
        added.status,
        repeated.status,
        (await repeated.json()).replayed,
        collided.status,
        peerAdded.status,
        (await summary.json()).reactions,
        missing.status,
      ],
      expected: [
        200,
        200,
        true,
        409,
        200,
        [{ reaction: '👍', count: 2, own: true }],
        404,
      ],
    });
    await client.unsafe(
      'update messaging_contact_pairs set low_blocks_high=true, revision=revision+1 where low_actor_id=$1 and high_actor_id=$2',
      [...[me.actorId, peer.actorId].sort()],
    );
    await client.unsafe(
      "update messaging_channels set lifecycle='archived',authority_revision=authority_revision+1 where id=$1",
      [channelId],
    );
    await client.unsafe('delete from account_age where user_id=$1', [
      me.userId,
    ]);
    const denied = await change(first.cookie, {
      ...command,
      requestId: createId(),
      reaction: '❤️',
    });
    const removed = await change(first.cookie, {
      ...command,
      requestId: createId(),
      active: false,
    });
    const now = await read(second.cookie);
    const own = await client.unsafe(
      'select actor_id from messaging_reactions where channel_id=$1 and message_id=$2 order by actor_id',
      [channelId, message.id],
    );
    const counters = await client.unsafe(
      'select message_sequence::int as sequence,change_version::int as version from messaging_channels where id=$1',
      [channelId],
    );
    const bells = await client.unsafe(
      "select payload from outbox where topic=$1 and kind='channel.changed' order by txid,seq",
      [`channel:${channelId}`],
    );
    assert({
      given:
        'archived blocked history with unknown posting age and an actual locked own reaction',
      should:
        'permit only own removal, preserve the peer association, advance changes without consuming sequence and emit thin bells',
      actual: [
        denied.status,
        removed.status,
        now.status,
        (await now.json()).reactions,
        z
          .array(z.object({ actor_id: z.string() }))
          .parse(Array.from(own))
          .map((row) => row.actor_id),
        Array.from(counters),
        z
          .array(z.object({ payload: z.record(z.string(), z.unknown()) }))
          .parse(Array.from(bells))
          .map((row) => Object.keys(row.payload).sort()),
      ],
      expected: [
        403,
        200,
        200,
        [{ reaction: '👍', count: 1, own: true }],
        [peer.actorId],
        [{ sequence: 1, version: 4 }],
        Array.from({ length: 4 }, () => ['changeVersion', 'channelId', 'kind']),
      ],
    });
  } finally {
    try {
      await mountedMessaging.closeMountedMessagingPair(
        client,
        channelId,
        me,
        peer,
      );
    } finally {
      await client.close();
    }
  }
});
