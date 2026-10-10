import type { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { buildChannelTopic, type ServerMessage } from '@daisy/protocol';
import { createDatabase } from './index';

setupRitewayBun();
const topic = buildChannelTopic('b'.repeat(24));
const hint = { v: 1, type: 'typing_changed', topic } as const;

function listenerFixture() {
  let notify!: (payload: string) => void;
  let ready!: () => void;
  let release!: () => void;
  let channel = '';
  let stopped = 0;
  const acknowledgement = new Promise<void>((resolve) => {
    release = resolve;
  });
  const client = {
    options: {},
    async listen(
      name: string,
      onNotify: (payload: string) => void,
      onListen: () => void,
    ) {
      channel = name;
      notify = onNotify;
      ready = onListen;
      await acknowledgement;
      return {
        unlisten: async () => {
          stopped += 1;
        },
      };
    },
  } as unknown as SQL;
  const database = createDatabase({
    client,
    url: 'postgres://localhost/unused_test',
    nextActorId: () => 'a'.repeat(24),
  });
  return {
    database,
    notify: (payload: string) => notify(payload),
    ready: () => ready(),
    release: () => release(),
    channel: () => channel,
    stopped: () => stopped,
  };
}

test('existing-pool hint listener waits for acknowledgement and validates channel-only frames', async () => {
  const f = listenerFixture();
  const frames: ServerMessage[] = [];
  let listens = 0;
  let acknowledged = false;
  const opening = f.database
    .listenRealtimeHints({
      onNotify: (frame) => frames.push(frame),
      onListen: () => {
        listens += 1;
      },
    })
    .then((subscription) => {
      acknowledged = true;
      return subscription;
    });
  await Promise.resolve();
  assert({
    given: 'an injected existing SQL client whose LISTEN is pending',
    should: 'use the dedicated channel without pretending startup is ready',
    actual: { channel: f.channel(), acknowledged },
    expected: { channel: 'daisy_realtime_hints', acknowledged: false },
  });
  f.release();
  const subscription = await opening;
  f.ready();
  for (const payload of [
    JSON.stringify(hint),
    'not-json',
    JSON.stringify({ ...hint, topic: `room:${'b'.repeat(24)}` }),
    JSON.stringify({ ...hint, position: '1:2' }),
    JSON.stringify({ ...hint, actorId: 'a'.repeat(24) }),
    JSON.stringify({ v: 1, type: 'ready' }),
    ' '.repeat(257),
  ])
    f.notify(payload);
  await subscription.unlisten();
  await subscription.unlisten();
  f.ready();
  f.notify(JSON.stringify(hint));
  assert({
    given:
      'one canonical hint, malformed/state-bearing frames and late callbacks after close',
    should:
      'deliver only the validated hint and release its existing listener once',
    actual: { frames, listens, stopped: f.stopped() },
    expected: { frames: [hint], listens: 1, stopped: 1 },
  });
});
