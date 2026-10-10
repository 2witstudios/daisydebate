import { assert, setupRitewayBun, test } from 'riteway/bun';
import { buildChannelTopic } from '@daisy/protocol';
import { harness, openAndReady } from './connection-store.test-support';

setupRitewayBun();
const channelId = 'b'.repeat(24);
const topic = buildChannelTopic(channelId);
const hint = { v: 1, type: 'typing_changed', topic };

test('typing hint reaches the owned topic consumer and leaves reconnect history unchanged', async () => {
  const h = harness();
  const local: string[] = [];
  const observed: string[] = [];
  h.store.subscribeTopic(topic, (frame) => local.push(frame.type));
  h.store.onMessage((frame) => observed.push(frame.type));
  await openAndReady(h);
  h.latestSocket().message({
    v: 1,
    type: 'event',
    topic,
    position: '7:4',
    payload: { kind: 'channel.changed', channelId, changeVersion: 4 },
  });
  h.latestSocket().message(hint);
  h.latestSocket().message({ ...hint, position: '7:5' });
  h.latestSocket().message({
    ...hint,
    topic: buildChannelTopic('c'.repeat(24)),
  });
  h.latestSocket().message({ ...hint, topic: `room:${channelId}` });
  h.latestSocket().remoteClose(1006);
  h.scheduler.advance(2_000);
  await openAndReady(h);
  const resume = h
    .latestSocket()
    .sent.map((raw) => JSON.parse(raw))
    .find((frame) => frame.type === 'subscribe');
  assert({
    given:
      'one authorized topic hint plus malformed, foreign and non-channel frames',
    should:
      'notify its refetch consumer without advancing or inventing an outbox cursor',
    actual: {
      local,
      observed: observed.filter((type) => type !== 'ready'),
      since: resume?.since,
    },
    expected: {
      local: ['event', 'typing_changed'],
      observed: ['event', 'typing_changed'],
      since: '7:4',
    },
  });
});

test('removing the final topic consumer also removes transient observation', async () => {
  const h = harness();
  const observed: string[] = [];
  const release = h.store.subscribeTopic(topic, () => {});
  h.store.onMessage((frame) => observed.push(frame.type));
  await openAndReady(h);
  release();
  h.latestSocket().message(hint);
  assert({
    given: 'a native typing hint for a topic with no remaining local consumer',
    should: 'refuse the unowned hint at the browser subscription boundary',
    actual: observed.filter((type) => type === 'typing_changed'),
    expected: [],
  });
});
