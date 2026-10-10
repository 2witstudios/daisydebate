import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixture, pendingRead, topic } from './registry.test-support';
setupRitewayBun();

test('periodic session checks start together rather than starving later connections', async () => {
  const reads = Array.from({ length: 3 }, () => pendingRead<boolean>());
  const f = fixture();
  for (let index = 0; index < 2; index += 1)
    f.registry.add(f.socket, f.connection.principal);
  f.setNow(50_000);
  let started = 0;
  const sweep = f.registry.revalidate(() => reads[started++]!.read());
  await Promise.resolve();
  assert({
    given: 'three stalled sessions at the periodic sweep',
    should: 'start every check within the same operational budget',
    actual: started,
    expected: 3,
  });
  f.setNow(55_000);
  for (const read of reads) read.resolve(false);
  await sweep;
  assert({
    given: 'all session budgets refuse at 55 seconds',
    should: 'close all recipients without serial deadline starvation',
    actual: f.closed,
    expected: [4002, 4002, 4002],
  });
});

test('periodic topic checks start together after the session check', async () => {
  const reads = Array.from({ length: 3 }, () => pendingRead<null>());
  let checking = false;
  let started = 0;
  const f = fixture({
    authorize: async () =>
      checking
        ? reads[started++]!.read()
        : { revision: '1', validUntil: 60_000 },
  });
  for (const id of ['b', 'e', 'f'])
    await f.registry.subscribe(f.connection, {
      id,
      topic: `room:${id.repeat(24)}`,
    });
  checking = true;
  f.setNow(55_000);
  const sweep = f.registry.revalidate(async () => true);
  await Promise.resolve();
  await Promise.resolve();
  assert({
    given: 'three stalled topic checks after session validation',
    should: 'start them together before the accepted backstop',
    actual: started,
    expected: 3,
  });
  f.setNow(60_000);
  for (const read of reads) read.resolve(null);
  await sweep;
  assert({
    given: 'all topic budgets refuse at the backstop',
    should: 'remove all subscriptions including the first topic',
    actual: [
      f.connection.topics.size,
      f.attached.size,
      f.connection.topics.has(topic),
    ],
    expected: [0, 0, false],
  });
});
