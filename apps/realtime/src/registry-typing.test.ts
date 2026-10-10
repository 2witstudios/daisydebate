import { assert, setupRitewayBun, test } from 'riteway/bun';
import { buildChannelTopic } from '@daisy/protocol';
import { fixture, pendingRead } from './registry.test-support';

setupRitewayBun();
const topic = buildChannelTopic('b'.repeat(24));
const hint = { v: 1, type: 'typing_changed', topic } as const;
const request = { id: 'typing-reader', topic };

async function subscribed(options: Parameters<typeof fixture>[0] = {}) {
  const f = fixture(options);
  f.registry.seed({ txid: '7', seq: 4n });
  await f.registry.subscribe(f.connection, request);
  f.sent.length = 0;
  return f;
}

test('transient hint freshly authorizes and never changes durable cursor or delivered position', async () => {
  let checks = 0;
  let through = '';
  const f = await subscribed({
    authorize: async () => {
      checks += 1;
      return { revision: String(checks), validUntil: 1_000 };
    },
    readCatchup: async (_topic, _since, cursor) => {
      through = `${cursor.txid}:${cursor.seq}`;
      return { rows: [], resync: false };
    },
  });
  await f.registry.hint(hint);
  const observed = {
    frames: [...f.sent],
    checks,
    delivered: f.connection.topics.get(topic)?.delivered,
  };
  await f.registry.subscribe(f.connection, { ...request, since: '7:4' });
  assert({
    given: 'an attached channel subscription and a content-free aggregate hint',
    should:
      'freshly authorize its native recipient without fabricating history',
    actual: { ...observed, through },
    expected: {
      frames: [hint],
      checks: 2,
      delivered: { txid: '7', seq: 4n },
      through: '7:4',
    },
  });
});

test('fresh typing denial detaches and retires the same subscription', async () => {
  let allowed = true;
  const f = await subscribed({
    authorize: async () =>
      allowed ? { revision: '1', validUntil: 1_000 } : null,
  });
  allowed = false;
  await f.registry.hint(hint);
  assert({
    given: 'revoked current channel authority after a successful subscribe',
    should: 'send no transient frame and remove native membership',
    actual: {
      frames: f.sent,
      attached: f.attached.size,
      retained: f.connection.topics.has(topic),
    },
    expected: { frames: [], attached: 0, retained: false },
  });
});

for (const race of [
  'unsubscribe',
  'close',
  'expiry',
  'invalidate',
  'replacement',
] as const)
  test(`typing late allow is fenced by ${race}`, async () => {
    const decision = pendingRead<{
      revision: string;
      validUntil: number;
    } | null>();
    let delay = false;
    const f = await subscribed({
      authorize: async () =>
        delay ? decision.read() : { revision: '1', validUntil: 1_000 },
    });
    delay = true;
    const delivery = f.registry.hint(hint);
    await decision.began;
    if (race === 'unsubscribe') f.registry.unsubscribe(f.connection, request);
    if (race === 'close') f.registry.remove(f.connection);
    if (race === 'expiry') f.setNow(1_000);
    if (race === 'invalidate')
      f.connection.topics.get(topic)?.lease.invalidate();
    if (race === 'replacement') {
      delay = false;
      await f.registry.subscribe(f.connection, {
        ...request,
        id: 'replacement',
      });
    }
    decision.resolve({ revision: '1', validUntil: 1_000 });
    await delivery;
    assert({
      given: `${race} during a pending canonical authority read`,
      should: 'refuse the stale transient allow at publication',
      actual: f.sent.filter((frame) => frame.type === 'typing_changed').length,
      expected: 0,
    });
  });

test('busy hints coalesce and strict invalid or unowned hints do not consult authority', async () => {
  const decision = pendingRead<{
    revision: string;
    validUntil: number;
  } | null>();
  let checks = 0;
  const f = await subscribed({
    authorize: async () => {
      checks += 1;
      return checks === 1
        ? { revision: '1', validUntil: 1_000 }
        : decision.read();
    },
  });
  await f.registry.hint({ ...hint, position: '7:5' });
  await f.registry.hint({ ...hint, topic: buildChannelTopic('c'.repeat(24)) });
  const deliveries = [
    f.registry.hint(hint),
    f.registry.hint(hint),
    f.registry.hint(hint),
  ];
  await decision.began;
  decision.resolve({ revision: '1', validUntil: 1_000 });
  await Promise.all(deliveries);
  assert({
    given:
      'invalid/unowned hints and three overlapping hints on an attached channel',
    should:
      'bound work to one fresh check and one native hint without cursor work',
    actual: { frames: f.sent, checks },
    expected: { frames: [hint], checks: 2 },
  });
});

test('a failing transient recipient cannot poison healthy same-batch or later delivery', async () => {
  const published: unknown[] = [];
  const f = await subscribed({
    publish: (nativeTopic, frame) => {
      if (nativeTopic.endsWith('#1')) throw new Error('Recipient unavailable');
      published.push(frame);
    },
  });
  const healthy = f.registry.add(
    { ...f.socket, bufferedAmount: () => 0 },
    {
      ...f.connection.principal,
      actorId: 'e'.repeat(24),
    },
  );
  await f.registry.subscribe(healthy, request);
  await f.registry.hint(hint);
  await f.registry.hint(hint);
  await f.registry.settled();
  assert({
    given: 'a failing recipient beside a current healthy native subscriber',
    should:
      'close only the failing connection and preserve current and later hints',
    actual: {
      published,
      closed: f.closed,
      failedClosed: f.connection.closed,
      healthyClosed: healthy.closed,
    },
    expected: {
      published: [hint, hint],
      closed: [4005],
      failedClosed: true,
      healthyClosed: false,
    },
  });
});
