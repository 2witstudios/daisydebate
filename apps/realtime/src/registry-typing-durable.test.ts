import { assert, setupRitewayBun, test } from 'riteway/bun';
import { buildChannelTopic, type ServerMessage } from '@daisy/protocol';
import { fixture, pendingRead } from './registry.test-support';
import { deferred } from './outbox-drain.test-support';

setupRitewayBun();
const channelId = 'b'.repeat(24);
const topic = buildChannelTopic(channelId);
const authority = { revision: '1', validUntil: 1_000 };

for (const first of ['hint', 'durable'] as const)
  test(`typing observation preserves a pending durable row when ${first} resolves first`, async () => {
    const durable = pendingRead<typeof authority>();
    const hint = pendingRead<typeof authority>();
    const eventWritten = deferred<void>();
    const published: ServerMessage[] = [];
    let checks = 0;
    const f = fixture({
      authorize: async () => {
        checks += 1;
        if (checks === 2) return durable.read();
        if (checks === 3) return hint.read();
        return authority;
      },
      publish: (_nativeTopic, frame) => {
        published.push(frame);
        if (frame.type === 'event') eventWritten.resolve();
      },
    });
    f.registry.seed({ txid: '7', seq: 4n });
    await f.registry.subscribe(f.connection, { id: 'reader', topic });
    f.registry.sink([
      {
        txid: '7',
        seq: 5n,
        topic,
        kind: 'channel.changed',
        version: 1,
        payload: { kind: 'channel.changed', channelId, changeVersion: 5 },
        createdAt: '2026-10-09T00:00:00.000Z',
      },
    ]);
    await durable.began;
    const pendingHint = f.registry.hint({
      v: 1,
      type: 'typing_changed',
      topic,
    });
    await hint.began;
    if (first === 'hint') {
      hint.resolve(authority);
      await pendingHint;
      durable.resolve(authority);
    } else {
      durable.resolve(authority);
      await eventWritten.promise;
      hint.resolve(authority);
    }
    await f.registry.settled();
    await pendingHint;
    const delivered = f.connection.topics.get(topic)?.delivered;
    assert({
      given: `a hint and durable authority read overlapping, ${first} completing first`,
      should:
        'preserve the durable event; a hint cannot supersede or extend its authority lease',
      actual: {
        frames: published.map((frame) => frame.type),
        delivered: `${delivered?.txid}:${delivered?.seq}`,
      },
      expected: {
        frames: first === 'hint' ? ['event'] : ['event', 'typing_changed'],
        delivered: '7:5',
      },
    });
  });
