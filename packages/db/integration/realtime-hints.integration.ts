import { requireTestServices } from '@daisy/config';
import { buildChannelTopic, type ServerMessage } from '@daisy/protocol';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('the pooled realtime hint listener acknowledges LISTEN and admits only channel frames', async () => {
  const client = new SQL(databaseUrl, { max: 1 });
  const writer = new SQL(databaseUrl, { max: 1 });
  const database = createDatabase({
    url: databaseUrl,
    client,
    nextActorId: createId,
  });
  const frames: ServerMessage[] = [];
  const hint = {
    v: 1,
    type: 'typing_changed',
    topic: buildChannelTopic(createId()),
  } as const;
  const marker = { ...hint, topic: buildChannelTopic(createId()) };
  const received = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  let listens = 0;
  try {
    const subscription = await database.listenRealtimeHints({
      onListen: () => {
        listens++;
        ready.resolve();
      },
      onNotify: (frame) => {
        frames.push(frame);
        if (frame.type === 'typing_changed' && frame.topic === marker.topic)
          received.resolve();
      },
    });
    try {
      await ready.promise;
      await writer.begin(async (tx) => {
        for (const payload of [
          JSON.stringify(hint),
          'not-json',
          JSON.stringify({ ...hint, topic: `room:${createId()}` }),
          JSON.stringify({ ...hint, position: '1:2' }),
          JSON.stringify({ ...hint, actorId: createId() }),
          JSON.stringify({ v: 1, type: 'ready' }),
          ' '.repeat(257),
          JSON.stringify(marker),
        ])
          await tx`select pg_notify('daisy_realtime_hints', ${payload})`;
      });
      await received.promise;
      await subscription.unlisten();
      await subscription.unlisten();
      const closedMarker = Promise.withResolvers<void>();
      const witness = await writer.listen('daisy_realtime_hints', () =>
        closedMarker.resolve(),
      );
      try {
        await client`select pg_notify('daisy_realtime_hints', ${JSON.stringify(hint)})`;
        await closedMarker.promise;
      } finally {
        await witness.unlisten();
      }
      assert({
        given:
          'a committed batch with state-bearing, malformed and channel-only hints',
        should:
          'emit exactly the channel-only hints, acknowledge once and stay closed after unlisten',
        actual: { listens, frames },
        expected: { listens: 1, frames: [hint, marker] },
      });
    } finally {
      await subscription.unlisten();
    }
  } finally {
    await Promise.all([database.close(), writer.close()]);
    await client.close();
  }
});
