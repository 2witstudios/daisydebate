import { virtualClock } from '@daisy/clock/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { openWebDatabase } from './database';

setupRitewayBun();

test('the web process composes every store with no name exposed twice', async () => {
  // Nothing dials until a store runs work, so an unreachable URL suffices.
  const database = openWebDatabase({
    url: 'postgresql://user:password@127.0.0.1:1/daisy',
    waits: virtualClock(),
    nextActorId: () => 'a'.repeat(24),
  });
  try {
    assert({
      given: 'the web composition over unconnected resources',
      should: 'build, every operation under one name',
      actual: typeof database.rateRound,
      expected: 'function',
    });
  } finally {
    await database.close();
  }
});
