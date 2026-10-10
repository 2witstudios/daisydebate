import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ENVELOPE_VERSION } from '@daisy/protocol';
import { harness, openAndReady } from './connection-store.test-support';

setupRitewayBun();
const topic = `channel:${'b'.repeat(24)}`;
const event = {
  v: ENVELOPE_VERSION,
  type: 'event',
  topic,
  position: '1:2',
  payload: {
    kind: 'channel.changed',
    channelId: 'b'.repeat(24),
    changeVersion: 2,
  },
};
test('topic consumers receive only validated coupled frames and reconnect cursors', async () => {
  const h = harness();
  const received: string[] = [];
  const unsubscribe = h.store.subscribeTopic(topic, (frame) =>
    received.push(frame.type),
  );
  await openAndReady(h);
  h.latestSocket().message({
    ...event,
    payload: { ...event.payload, channelId: 'c'.repeat(24) },
  });
  h.latestSocket().message(event);
  h.latestSocket().remoteClose(1006);
  h.scheduler.advance(2_000);
  await openAndReady(h);
  const frames = h.latestSocket().sent.map((value) => JSON.parse(value));
  assert({
    given: 'one valid event and one mismatched payload before reconnect',
    should: 'notify once and resume the validated cursor',
    actual: {
      received,
      since: frames.find((frame) => frame.type === 'subscribe')?.since,
    },
    expected: { received: ['event'], since: '1:2' },
  });
  unsubscribe();
  assert({
    given: 'last consumer removal',
    should: 'send unsubscribe',
    actual: JSON.parse(h.latestSocket().sent.at(-1)!).type,
    expected: 'unsubscribe',
  });
});
test('invalid ready cannot open a connection', async () => {
  const h = harness();
  h.store.connect();
  h.latestSocket().message({ type: 'ready' });
  assert({
    given: 'a missing envelope version',
    should: 'remain connecting',
    actual: h.store.getState().status,
    expected: 'connecting',
  });
});
test('resync clears a historical cursor before the feature resubscribes', async () => {
  const h = harness();
  const received: string[] = [];
  h.store.subscribeTopic(topic, (frame) => received.push(frame.type));
  await openAndReady(h);
  h.latestSocket().message(event);
  h.store.resubscribeTopic(topic);
  const request = JSON.parse(h.latestSocket().sent.at(-1)!);
  h.latestSocket().message({
    v: ENVELOPE_VERSION,
    type: 'resync_required',
    topic,
    id: request.id,
  });
  h.store.resubscribeTopic(topic);
  assert({
    given: 'a server refusal of retained history',
    should: 'notify the HTTP reader and omit the refused cursor next time',
    actual: {
      received,
      since: JSON.parse(h.latestSocket().sent.at(-1)!).since ?? null,
    },
    expected: { received: ['event', 'resync_required'], since: null },
  });
});

test('each registration retains authority to the shared topic until its own removal', async () => {
  const h = harness();
  const received: string[] = [];
  const listener = (frame: import('@daisy/protocol').ServerMessage) =>
    received.push(frame.type);
  const first = h.store.subscribeTopic(topic, listener);
  const second = h.store.subscribeTopic(topic, listener);
  await openAndReady(h);
  first();
  first();
  h.latestSocket().message(event);
  const beforeLast = h
    .latestSocket()
    .sent.map((raw) => JSON.parse(raw))
    .filter((frame) => frame.type === 'unsubscribe').length;
  second();
  const afterLast = h
    .latestSocket()
    .sent.map((raw) => JSON.parse(raw))
    .filter((frame) => frame.type === 'unsubscribe').length;
  assert({
    given:
      'two registrations of the same callback and an idempotent first cleanup',
    should:
      'retain the second registration and unsubscribe once after its removal',
    actual: { received, beforeLast, afterLast },
    expected: { received: ['event'], beforeLast: 0, afterLast: 1 },
  });
});
