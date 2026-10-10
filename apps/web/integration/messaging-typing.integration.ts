import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import {
  buildChannelTopic,
  ENVELOPE_VERSION,
  type ServerMessage,
} from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { origin } from './fixtures';
import {
  mountedMessagingPair,
  closeMountedMessagingPair,
  seedMessagingRouteDm,
  messagingRoutePolicy,
} from './messaging-route.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('mounted typing qualifies actual leases and publishes only changed aggregate projections', async () => {
  const { app, client, channelId, me, peer, first, second, routes } =
    await mountedMessagingPair(databaseUrl, {
      messagingPolicy: {
        ...messagingRoutePolicy,
        typing: { ttlMs: 6000, refetchMs: 1000, maxActors: 2 },
      },
    });
  const hints: ServerMessage[] = [],
    ready = Promise.withResolvers<void>();
  const barriers = new Map<string, () => void>();
  const subscription = await app.app.database.listenRealtimeHints({
    onListen: () => ready.resolve(),
    onNotify: (frame) => {
      const barrier = barriers.get(frame.topic);
      if (barrier) barrier();
      else hints.push(frame);
    },
  });
  const flushNotifications = async () => {
    const topic = buildChannelTopic(createId()),
      received = Promise.withResolvers<void>();
    barriers.set(topic, received.resolve);
    await client.unsafe("select pg_notify('daisy_realtime_hints',$1)", [
      JSON.stringify({ v: ENVELOPE_VERSION, type: 'typing_changed', topic }),
    ]);
    await received.promise;
    barriers.delete(topic);
  };
  const update = (typing: boolean) =>
    routes.messaging.typing(
      app.jsonPost(
        '/api/messaging/typing',
        { version: 1, channelId, typing },
        { cookie: first.cookie },
      ),
      true,
    );
  const read = (cookie: string, id = channelId) =>
    routes.messaging.typing(
      new Request(`${origin}/api/messaging/channels/${id}/typing`, {
        headers: { cookie },
      }),
      false,
      id,
    );
  try {
    await ready.promise;
    await seedMessagingRouteDm(
      client,
      me,
      peer,
      channelId,
      app.app.clock.now(),
    );
    const start = await update(true),
      self = await read(first.cookie),
      observer = await read(second.cookie);
    await flushNotifications();
    assert({
      given: 'actual accepted DM, current accounts/age and authorized start',
      should: 'show only peer aggregate and publish a channel-only hint',
      actual: [
        start.status,
        (await self.json()).typing,
        (await observer.json()).typing,
        hints,
      ],
      expected: [
        200,
        false,
        true,
        [
          {
            v: ENVELOPE_VERSION,
            type: 'typing_changed',
            topic: buildChannelTopic(channelId),
          },
        ],
      ],
    });
    const renewal = await update(true);
    await flushNotifications();
    assert({
      given: 'renewal of an already visible lease',
      should: 'preserve the projection without an activity hint',
      actual: [renewal.status, hints.length],
      expected: [200, 1],
    });
    const stop = await update(false),
      cleared = await read(second.cookie);
    await flushNotifications();
    assert({
      given: 'own stop changes the peer projection',
      should: 'publish exactly the second content-free transition',
      actual: [stop.status, (await cleared.json()).typing, hints.length],
      expected: [200, false, 2],
    });
    await update(true);
    await client.unsafe(
      'update account_age set version=version+1 where user_id=$1',
      [me.userId],
    );
    const stale = await read(second.cookie);
    await client.unsafe('delete from account_age where user_id=$1', [
      me.userId,
    ]);
    const unavailable = await update(true),
      retained = await read(second.cookie);
    const absent = await read(first.cookie, createId()),
      anonymous = await read('');
    const outbox = await client.unsafe(
      "select count(*)::int as count from outbox where payload->>'kind'='typing_changed' and payload->>'channelId'=$1",
      [channelId],
    );
    assert({
      given:
        'actual corrected/removed age source, a retained old lease and unknown/anonymous scope',
      should:
        'refuse stale lease authority, deny new posting and create no durable typing event',
      actual: [
        (await stale.json()).typing,
        unavailable.status,
        (await retained.json()).typing,
        absent.status,
        anonymous.status,
        outbox[0]?.count,
      ],
      expected: [false, 403, false, 404, 401, 0],
    });
  } finally {
    await subscription.unlisten();
    try {
      await Promise.all(
        [me, peer].map((actor) =>
          app.app.redis.clearTypingLease(channelId, actor.actorId),
        ),
      );
      await closeMountedMessagingPair(client, channelId, me, peer);
    } finally {
      await client.close();
    }
  }
});
