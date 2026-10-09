import type { Identity } from '@daisy/auth';
import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { seedMessagingTestDm } from '@daisy/db/testing';
import {
  messagingFixturePosting,
  messagingFixtureReading,
} from './messaging-policy.test-support';
import { createRoutes } from '../src/server/routes';
import { createTestApp, origin, testDatabaseUrl } from './fixtures';
import { createAccountFlows, uniqueName } from './auth-account-helpers';

setupRitewayBun();
requireTestServices(process.env);
test('mounted messaging composition uses real signed-in actors and shared HTTP gates', async () => {
  const testApp = createTestApp();
  const accounts = createAccountFlows(testApp);
  const first = await accounts.signUp(),
    second = await accounts.signUp();
  await accounts.claim(first.cookie, { username: uniqueName() });
  await accounts.claim(second.cookie, { username: uniqueName() });
  const me = requireActor(await accounts.identifyAs(first.cookie)),
    peer = requireActor(await accounts.identifyAs(second.cookie));
  const client = new SQL(testDatabaseUrl),
    channelId = createId();
  const [low, high] = [me.actorId, peer.actorId].sort();
  const now = testApp.app.clock.now();
  const routes = createRoutes({
    ...testApp.app,
    messagingPolicy: {
      bounds: { messageUnits: 100, pageItems: 20 },
      maxBodyBytes: 1024,
      editWindowMs: 60000,
      posting: messagingFixturePosting,
      reading: messagingFixtureReading,
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
      [me.userId, peer.userId, now],
    );
    await seedMessagingTestDm(client, {
      actorId: me.actorId,
      otherActorId: peer.actorId,
      channelId,
      now,
    });
    await client.unsafe(
      'update messaging_channels set change_version=1 where id=$1',
      [channelId],
    );
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
        sentActor: me.actorId,
        text: 'Private routed text',
      },
    });
    const searchRequest = (id: string, query: string) =>
      new Request(
        `${origin}/api/messaging/channels/${id}/messages/search?query=${encodeURIComponent(query)}`,
        { headers: { origin, cookie: second.cookie } },
      );
    for (const [query, count] of [
      ['ROUTED', 1],
      ['%', 0],
      ['not present', 0],
    ] as const) {
      const found = await routes.messaging.search(
        searchRequest(channelId, query),
        channelId,
      );
      assert({
        given: `entitled literal search ${query}`,
        should:
          'return only matching channel messages without wildcard expansion',
        actual: {
          status: found.status,
          count: (await found.json()).messages.length,
        },
        expected: { status: 200, count },
      });
    }
    const changesRequest = () =>
      new Request(
        `${origin}/api/messaging/channels/${channelId}/changes?limit=20&after=0`,
        { headers: { origin, cookie: first.cookie } },
      );
    const firstChanges = await routes.messaging.changes(
      changesRequest(),
      channelId,
    );
    assert({
      given: 'first send after an authority-only establishment version',
      should: 'classify creation independently from ordering equality',
      actual: {
        status: firstChanges.status,
        kind: (await firstChanges.json()).changes?.[0]?.kind,
      },
      expected: { status: 200, kind: 'created' },
    });
    const mutationBody = {
      version: 1,
      channelId,
      messageId: sentBody.id,
      requestId: createId(),
      text: 'Edited through HTTP',
    };
    const edited = await routes.messaging.edit(
      testApp.jsonPost('/api/messaging/messages/edit', mutationBody, {
        cookie: first.cookie,
      }),
    );
    assert({
      given: 'the signed-in author editing through the real composed handler',
      should: 'return the new public message with its creation sequence',
      actual: { status: edited.status, body: (await edited.json()).text },
      expected: { status: 200, body: 'Edited through HTTP' },
    });
    const removed = await routes.messaging.remove(
      testApp.jsonPost(
        '/api/messaging/messages/remove',
        {
          version: 1,
          channelId,
          messageId: sentBody.id,
          requestId: createId(),
        },
        { cookie: first.cookie },
      ),
    );
    const removedBody = await removed.json();
    assert({
      given: 'the author removing through the composed handler',
      should:
        'return only an unavailable cursor without author or private text',
      actual: { status: removed.status, keys: Object.keys(removedBody).sort() },
      expected: {
        status: 200,
        keys: ['changeVersion', 'channelId', 'id', 'sequence', 'unavailable'],
      },
    });
    const removedSearch = await routes.messaging.search(
      searchRequest(channelId, 'Edited'),
      channelId,
    );
    assert({
      given: 'removed text after an entitled search',
      should: 'never resurrect content or its matching identity',
      actual: {
        status: removedSearch.status,
        messages: (await removedSearch.json()).messages,
      },
      expected: { status: 200, messages: [] },
    });
    const unavailableChannel = createId();
    const foreignSearch = await routes.messaging.search(
      searchRequest(unavailableChannel, 'Private'),
      unavailableChannel,
    );
    assert({
      given: 'a foreign unavailable channel search',
      should: 'mask the channel without returning content',
      actual: foreignSearch.status,
      expected: 404,
    });
    await client.unsafe(
      'update messaging_channels set change_version=change_version+1 where id=$1',
      [channelId],
    );
    const exhausted = await routes.messaging.changes(
      changesRequest(),
      channelId,
    );
    const exhaustedBody = await exhausted.json();
    assert({
      given: 'authority-only advance after the last removed content change',
      should: 'return an exhausted channel-head cursor without a schema error',
      actual: {
        status: exhausted.status,
        last: exhaustedBody.changes?.[0]?.changeVersion,
        cursor: exhaustedBody.nextAfter?.changeVersion,
      },
      expected: { status: 200, last: 4, cursor: 5 },
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
      me.userId,
      peer.userId,
    ]);
    await client.close();
  }
});

function requireActor(identity: Identity) {
  if (identity.state !== 'member' || identity.principal.actorId === null)
    throw new Error('Real member actor required');
  return { ...identity.principal, actorId: identity.principal.actorId };
}
