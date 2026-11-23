import { virtualClock } from '@daisy/clock/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { openRealtimeDatabase } from './database';

setupRitewayBun();

test('the realtime process composes its stores with no name exposed twice', async () => {
  // Nothing dials until a store runs work, so an unreachable URL suffices.
  const database = openRealtimeDatabase({
    url: 'postgresql://user:password@127.0.0.1:1/daisy',
    waits: virtualClock(),
  });
  try {
    assert({
      given: 'the realtime composition over unconnected resources',
      should: 'build, its outbox and authority reads under one name each',
      actual: [
        typeof database.listenOutbox,
        typeof database.renewServiceInstance,
      ],
      expected: ['function', 'function'],
    });
  } finally {
    await database.close();
  }
});
