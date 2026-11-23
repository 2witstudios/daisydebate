import { virtualClock } from '@daisy/clock/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { openDatabaseResources } from './resources';
import { createRoomStore } from './stores/rooms';

setupRitewayBun();

test('Room writes expose only the canonical command adapter', async () => {
  const resources = openDatabaseResources({
    url: 'postgresql://unused@127.0.0.1:1/unused',
    waits: virtualClock(),
  });
  const database = createRoomStore(resources, {
    nextId: () => {
      throw new Error('Surface inspection requires no actor');
    },
  });
  try {
    assert({
      given: 'the Room store',
      should:
        'expose no legacy seat, prep or freeze path that bypasses Room policy and memberships',
      actual: ['seatRoomParticipant', 'startRoomPrep', 'startRound'].filter(
        (name) => name in database,
      ),
      expected: [],
    });
  } finally {
    await resources.close();
  }
});
