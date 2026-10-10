import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';

import { createRoutes } from '../src/server/routes';
import { createTestApp, origin } from './fixtures';
import {
  messagingRouteActors,
  messagingRoutePolicy,
  seedMessagingRouteDm,
} from './messaging-route.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const selections = {
  following: false,
  hidden: false,
  notificationLevel: 'none' as const,
};
test('mounted preferences preserve eligible unfollowed history and current unread progress without disclosing outsider metadata', async () => {
  const app = createTestApp(),
    { first, second, me, peer } = await messagingRouteActors(app);
  const client = new SQL(databaseUrl),
    channelId = createId();
  const routes = createRoutes({
    ...app.app,
    messagingPolicy: messagingRoutePolicy,
  });
  const request = (cookie: string, id = channelId) =>
    new Request(`${origin}/api/messaging/channels/${id}/preferences`, {
      headers: { cookie },
    });
  const scope = { version: 1, channelId };
  const change = () =>
    routes.messaging.preferences(
      app.jsonPost(
        '/api/messaging/preferences',
        { ...scope, ...selections },
        { cookie: first.cookie },
      ),
      'update',
    );
  try {
    await seedMessagingRouteDm(
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
          ...scope,
          requestId: createId(),
          text: 'Unread private contribution',
        },
        { cookie: second.cookie },
      ),
    );
    const message = await sent.json();
    const saved = await change(),
      body = await saved.json();
    const history = await routes.messaging.history(
      new Request(`${origin}/api/messaging/channels/${channelId}/messages`, {
        headers: { cookie: first.cookie },
      }),
      channelId,
    );
    assert({
      given: 'eligible unfollowed recipient with an actual peer contribution',
      should:
        'retain history eligibility and report only current own progress plus unread count',
      actual: [
        sent.status,
        saved.status,
        history.status,
        body.state,
        body.unread,
      ],
      expected: [200, 200, 200, { ...selections, readSequence: 0 }, 1],
    });
    const hidden = await routes.messaging.preferences(
      app.jsonPost(
        '/api/messaging/preferences',
        { ...scope, ...selections, hidden: true },
        { cookie: first.cookie },
      ),
      'update',
    );
    const inbox = await routes.messaging.inbox(
      new Request(`${origin}/api/messaging/inbox`, {
        headers: { cookie: first.cookie },
      }),
    );
    const entries = (await inbox.json()).entries;
    assert({
      given: 'an explicit hidden preference with current retained entitlement',
      should:
        'omit the own inbox entry without changing access to the conversation',
      actual: [
        hidden.status,
        entries.some(
          (entry: { channelId: string }) => entry.channelId === channelId,
        ),
      ],
      expected: [200, false],
    });
    const marker = await routes.messaging.markRead(
      app.jsonPost(
        '/api/messaging/read',
        { ...scope, cursor: { channelId, sequence: 1 } },
        { cookie: first.cookie },
      ),
    );
    const updated = await change(),
      progress = await updated.json();
    assert({
      given: 'actual read progress followed by a preference update',
      should: 'preserve the marker and never reset unread progress',
      actual: [marker.status, progress.state.readSequence, progress.unread],
      expected: [200, 1, 0],
    });
    const removed = await routes.messaging.remove(
      app.jsonPost(
        '/api/messaging/messages/remove',
        { ...scope, requestId: createId(), messageId: message.id },
        { cookie: second.cookie },
      ),
    );
    const cleared = await routes.messaging.preferences(
      app.jsonPost('/api/messaging/preferences/clear', scope, {
        cookie: first.cookie,
      }),
      'clear',
    );
    const absent = await routes.messaging.preferences(
      request(first.cookie),
      'read',
      channelId,
    );
    const denied = await routes.messaging.preferences(
      request(first.cookie, createId()),
      'read',
      createId(),
    );
    const anonymous = await routes.messaging.preferences(
      request(''),
      'read',
      channelId,
    );
    assert({
      given:
        'own clear, removed peer text and concealed missing/anonymous metadata',
      should:
        'return absence without counting removed content and preserve boundary error semantics',
      actual: [
        removed.status,
        cleared.status,
        await absent.json(),
        denied.status,
        anonymous.status,
      ],
      expected: [200, 200, { ...scope, state: null, unread: 0 }, 404, 401],
    });
  } finally {
    await client.unsafe('delete from messaging_channels where id=$1', [
      channelId,
    ]);
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
