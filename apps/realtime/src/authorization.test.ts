import { assert, setupRitewayBun, test } from 'riteway/bun';
import { buildChannelTopic } from '@daisy/protocol';
import type { RealtimeApp } from './app';
import { createRealtimeAuthorization } from './authorization';

setupRitewayBun();
const principal = {
  userId: 'u'.repeat(24),
  actorId: 'a'.repeat(24),
  sessionId: 's'.repeat(24),
};

test('channel topics are refused without any database authorization', async () => {
  const calls: string[] = [];
  const database = new Proxy(
    {},
    {
      get: (_target, name) => async () => {
        calls.push(String(name));
        return null;
      },
    },
  );
  const auth = createRealtimeAuthorization({
    resources: {
      clock: { now: () => '2026-10-13T00:00:00.000Z' },
      database,
    } as unknown as RealtimeApp,
    now: () => 0,
  });
  const subscribers = Array.from({ length: 5 }, (_, index) => ({
    ...principal,
    sessionId: `${index}`.repeat(24),
  }));
  const results = await Promise.all(
    subscribers.map((subscriber) =>
      auth.authorizeTopic(subscriber, buildChannelTopic('c'.repeat(24))),
    ),
  );
  assert({
    given:
      'five sockets asking for a channel topic, whose live signals ride the channel observation',
    should: 'refuse every one and read nothing from the database',
    actual: { results, calls },
    expected: { results: [null, null, null, null, null], calls: [] },
  });
});
