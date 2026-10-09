import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { seedMessagingTestDm } from '@daisy/db/testing';
import { socialPolicyEvidence } from '@daisy/auth/social-policy';
import { createRoutes } from '../src/server/routes';
import { createTestApp, origin, testDatabaseUrl } from './fixtures';
import { createAccountFlows, uniqueName } from './auth-account-helpers';

setupRitewayBun();
test('mounted messaging composition uses real signed-in actors and shared HTTP gates', async () => {
  const testApp = createTestApp();
  const accounts = createAccountFlows(testApp);
  const first = await accounts.signUp(),
    second = await accounts.signUp();
  await accounts.claim(first.cookie, { username: uniqueName() });
  await accounts.claim(second.cookie, { username: uniqueName() });
  const me = await accounts.identifyAs(first.cookie),
    peer = await accounts.identifyAs(second.cookie);
  if (
    me.state !== 'member' ||
    peer.state !== 'member' ||
    me.principal.actorId === null ||
    peer.principal.actorId === null
  )
    throw new Error('Real member actors required');
  const client = new SQL(testDatabaseUrl),
    channelId = createId();
  const [low, high] = [me.principal.actorId, peer.principal.actorId].sort();
  const now = testApp.app.clock.now();
  const routes = createRoutes({
    ...testApp.app,
    messagingPolicy: {
      bounds: { messageUnits: 100, pageItems: 20 },
      maxBodyBytes: 1024,
      posting: {
        state: 'approved',
        decision: 'Integration fixture only',
        key: 'social.dm',
        revision: 1,
        allowedBandPairs: [['adult', 'adult']],
      },
      reading: (input) => ({
        ...socialPolicyEvidence(input.channel, input.accounts, input.now),
        allowed: true,
      }),
      limits: {
        actorSend: { max: 10, windowSeconds: 60 },
        channelSend: { max: 10, windowSeconds: 60 },
        read: { max: 20, windowSeconds: 60 },
      },
    },
  });
  try {
    await client.unsafe(
      "insert into account_age(user_id,birth_month,version,recorded_at) values($1,'2000-01',1,$3),($2,'2000-01',1,$3)",
      [me.principal.userId, peer.principal.userId, now],
    );
    await seedMessagingTestDm(client, {
      actorId: me.principal.actorId,
      otherActorId: peer.principal.actorId,
      channelId,
      now,
    });
    const sent = await routes.messaging.send(
      testApp.jsonPost(
        '/api/messaging/messages',
        {
          version: 1,
          channelId,
          requestId: createId(),
          text: 'Private routed text',
        },
        { cookie: first.cookie },
      ),
    );
    const sentBody = await sent.json();
    const request = (id: string, cookie: string) =>
      new Request(`${origin}/api/messaging/channels/${id}/messages?limit=20`, {
        headers: { origin, cookie },
      });
    const read = await routes.messaging.history(
      request(channelId, second.cookie),
      channelId,
    );
    const readBody = await read.json();
    assert({
      given:
        'two accounts signed in through actual mounted auth and username routes',
      should: 'send and read through the composed actor-bound messaging routes',
      actual: {
        sendStatus: sent.status,
        readStatus: read.status,
        sentActor: sentBody.authorActorId,
        text: readBody.messages?.[0]?.text,
      },
      expected: {
        sendStatus: 200,
        readStatus: 200,
        sentActor: me.principal.actorId,
        text: 'Private routed text',
      },
    });
    const hidden = createId();
    const missing = await routes.messaging.history(
      request(hidden, second.cookie),
      hidden,
    );
    assert({
      given: 'an unknown channel under the same signed-in session',
      should: 'conceal it without protected content',
      actual: {
        status: missing.status,
        containsText: (await missing.text()).includes('Private routed text'),
      },
      expected: { status: 404, containsText: false },
    });
    const anonymous = await routes.messaging.history(
      request(channelId, ''),
      channelId,
    );
    assert({
      given: 'an anonymous history request',
      should: 'refuse before protected channel access',
      actual: anonymous.status,
      expected: 401,
    });
    const held = await createRoutes(testApp.app).messaging.send(
      testApp.jsonPost('/api/messaging/messages', {}, { cookie: first.cookie }),
    );
    assert({
      given: 'no injected approved messaging policy at the production edge',
      should: 'remain unavailable without assuming product approval',
      actual: held.status,
      expected: 503,
    });
  } finally {
    await client.unsafe('delete from messaging_channels where id=$1', [
      channelId,
    ]);
    await client.unsafe(
      'delete from messaging_contact_pairs where low_actor_id=$1 and high_actor_id=$2',
      [low, high],
    );
    await client.unsafe("delete from outbox where payload->>'channelId'=$1", [
      channelId,
    ]);
    await client.unsafe('delete from account_age where user_id in ($1,$2)', [
      me.principal.userId,
      peer.principal.userId,
    ]);
    await client.close();
  }
});
