import { virtualClock } from '@daisy/clock/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createPublicObjects } from './objects';

setupRitewayBun();

const clock = virtualClock();
const stalledObjects = (port: number | undefined) =>
  createPublicObjects({
    waits: clock,
    endpoint: `http://127.0.0.1:${port}`,
    bucket: 'public',
    key: 'key',
    secret: 'secret',
    timeoutMs: 50,
  });

/** Starts `run`, moves virtual time to its timeout, then waits for it to settle. */
const rejection = async (run: () => Promise<void>) => {
  const settled = run().then(
    () => 'settled',
    (error: Error) => error.name,
  );
  await clock.advance(50);
  return settled;
};

test('a stalled store releases the publisher', async () => {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Promise<Response>(() => undefined),
  });
  try {
    const objects = stalledObjects(server.port);
    assert({
      given: 'a store that never answers a write or a delete',
      should: 'give up on each by its timeout',
      actual: [
        await rejection(() => objects.putState('state/a.json', '{}', {})),
        await rejection(() => objects.deletePublic('state/a.json')),
      ],
      expected: ['TimeoutError', 'TimeoutError'],
    });
  } finally {
    await server.stop(true);
  }
});
