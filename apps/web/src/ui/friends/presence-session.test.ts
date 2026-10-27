import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createPresenceSessions } from './presence-session';

setupRitewayBun();

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const harness = (respond: () => Response) => {
  const events: string[] = [];
  const retain = createPresenceSessions({
    fetch: async (url) => {
      events.push(`read ${url}`);
      return respond();
    },
    startBeacon: (endpoint) => {
      events.push(`beacon ${endpoint}`);
      return () => events.push('beacon stopped');
    },
    setInterval: () => {
      events.push('poll armed');
      return 1;
    },
    clearInterval: () => events.push('poll cleared'),
  });
  return { retain, events };
};

test('one shared session answers every listener and opens one socket', async () => {
  const { retain, events } = harness(() =>
    Response.json(
      { version: 1, friendsOnline: 3, membersOnline: 5 },
      { headers: { 'x-realtime-socket-url': 'wss://realtime.daisy.test/ws' } },
    ),
  );
  const seen: number[] = [];
  const releaseRail = retain((count) => seen.push(count));
  const releaseTabs = retain((count) => seen.push(count * 10));
  await flush();
  releaseRail();
  const afterRail = [...events];
  releaseTabs();
  assert({
    given: 'two shell parts joining one tab session, then leaving',
    should:
      'read once, hand both the count, open one socket and stop only when the last leaves',
    actual: [seen, afterRail, events.slice(afterRail.length)],
    expected: [
      [3, 30],
      [
        'read /api/friends/online',
        'poll armed',
        'beacon wss://realtime.daisy.test/ws',
      ],
      ['poll cleared', 'beacon stopped'],
    ],
  });
});

test('a refused, malformed or dropped read changes nothing', async () => {
  const seen: number[] = [];
  for (const respond of [
    () => new Response(null, { status: 401 }),
    () => Response.json({ version: 2 }),
    () => {
      throw new Error('offline');
    },
  ]) {
    const { retain, events } = harness(respond);
    const release = retain((count) => seen.push(count));
    await flush();
    release();
    if (events.some((event) => event.startsWith('beacon '))) seen.push(-1);
  }
  assert({
    given: 'a 401, a malformed body and a dropped connection',
    should: 'report no count and open no socket',
    actual: seen,
    expected: [],
  });
});
