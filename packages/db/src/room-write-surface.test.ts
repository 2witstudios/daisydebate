import { virtualClock } from '@daisy/clock/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from './index';

setupRitewayBun();

test('Room writes expose only the canonical command adapter', async () => {
  const database = createDatabase({
    url: 'postgresql://unused@127.0.0.1:1/unused',
    waits: virtualClock(),
    nextActorId: () => {
      throw new Error('Surface inspection requires no actor');
    },
  });
  try {
    assert({
      given: 'the public database adapter',
      should:
        'expose no legacy seat, prep or freeze path that bypasses Room policy and memberships',
      actual: ['seatRoomParticipant', 'startRoomPrep', 'startRound'].filter(
        (name) => name in database,
      ),
      expected: [],
    });
  } finally {
    await database.close();
  }
});
