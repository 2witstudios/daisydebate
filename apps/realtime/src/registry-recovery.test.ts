import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixture, row, topic } from './registry.test-support';

setupRitewayBun();

type Decision = { revision: string; validUntil: number } | null | 'fail';

/** A registry whose authority answers come from a script the test changes. */
async function suspended() {
  let decision: Decision = { revision: '1', validUntil: 60_000 };
  const f = fixture({
    authorize: async () => {
      if (decision === 'fail') throw new Error('authority read failed');
      return decision;
    },
  });
  await f.registry.subscribe(f.connection, { id: 'request', topic });
  const frames = () =>
    f.sent.map((frame) =>
      frame.type === 'error' ? `${frame.code}:${frame.id}` : frame.type,
    );
  return {
    ...f,
    frames,
    decide: (next: Decision) => {
      decision = next;
    },
    revalidate: () => f.registry.revalidate(async () => true),
  };
}

test('a stream detached on expiry resyncs on recovery instead of reattaching', async () => {
  const f = await suspended();
  f.setNow(60_000);
  f.decide('fail');
  await f.revalidate();
  const whileSuspended = { attached: f.attached.size, frames: f.frames() };
  f.registry.sink([row(1)]);
  await f.registry.settled();
  f.decide({ revision: '1', validUntil: 120_000 });
  await f.revalidate();
  assert({
    given:
      'an expired subscription whose renewal failed, a mutation while it was detached, then a fresh allow and no later mutation',
    should:
      'stay detached while suspended, then ask the subscriber to reread rather than reattach the gapped stream',
    actual: {
      whileSuspended,
      frames: f.frames(),
      attached: f.attached.size,
      retained: f.connection.topics.has(topic),
    },
    expected: {
      whileSuspended: { attached: 0, frames: ['subscribed'] },
      frames: ['subscribed', 'resync_required'],
      attached: 0,
      retained: false,
    },
  });
});

test('an unavailable renewal of a current stream changes nothing', async () => {
  const f = await suspended();
  f.decide('fail');
  await f.revalidate();
  assert({
    given: 'a renewal that cannot decide while the lease is still current',
    should: 'keep the stream attached and send nothing',
    actual: { frames: f.frames(), attached: f.attached.size },
    expected: { frames: ['subscribed'], attached: 1 },
  });
});

test('a definitive denial ends the subscription and a later allow cannot revive it', async () => {
  const f = await suspended();
  f.decide(null);
  await f.revalidate();
  f.decide({ revision: '1', validUntil: 60_000 });
  await f.revalidate();
  f.registry.sink([row(1)]);
  await f.registry.settled();
  assert({
    given: 'a revalidation that denies, then an allow and an event',
    should:
      'answer AUTHORIZATION on the subscription request once, publish nothing, and never reattach',
    actual: {
      frames: f.frames(),
      attached: f.attached.size,
      retained: f.connection.topics.has(topic),
    },
    expected: {
      frames: ['subscribed', 'AUTHORIZATION:request'],
      attached: 0,
      retained: false,
    },
  });
});

test('a denial on one topic leaves another topic attached', async () => {
  const other = `room:${'e'.repeat(24)}`;
  let deny = false;
  const f = fixture({
    authorize: async (_principal, requested) =>
      deny && requested === topic
        ? null
        : { revision: '1', validUntil: 60_000 },
  });
  await f.registry.subscribe(f.connection, { id: 'a', topic });
  await f.registry.subscribe(f.connection, { id: 'b', topic: other });
  deny = true;
  await f.registry.revalidate(async () => true);
  assert({
    given: 'two subscriptions and a denial for only one of them',
    should: 'end only the denied one',
    actual: [...f.connection.topics.keys()],
    expected: [other],
  });
});

test('access.revoked ends exactly the named subscription on its request', async () => {
  const { buildDebateTopic, buildUserInboxTopic } =
    await import('@daisy/protocol');
  const revoked = 'f'.repeat(24);
  const kept = 'g'.repeat(24);
  const f = fixture();
  await f.registry.subscribe(f.connection, {
    id: 'revoked',
    topic: buildDebateTopic(revoked),
  });
  await f.registry.subscribe(f.connection, {
    id: 'kept',
    topic: buildDebateTopic(kept),
  });
  const actorId = f.connection.principal.actorId;
  f.registry.sink([
    {
      ...row(1),
      topic: buildUserInboxTopic(actorId),
      kind: 'access.revoked',
      payload: {
        kind: 'access.revoked',
        entityVersion: 1,
        ids: [actorId, revoked],
      },
    },
  ]);
  await f.registry.revalidate(async () => true);
  await f.registry.settled();
  assert({
    given: 'an access.revoked control for one of two debate subscriptions',
    should:
      'answer AUTHORIZATION on that request only, and not revive it on a later allow',
    actual: {
      errors: f.sent
        .filter((frame) => frame.type === 'error')
        .map((frame) => frame.type === 'error' && `${frame.code}:${frame.id}`),
      topics: [...f.connection.topics.keys()],
    },
    expected: {
      errors: ['AUTHORIZATION:revoked'],
      topics: [buildDebateTopic(kept)],
    },
  });
});
