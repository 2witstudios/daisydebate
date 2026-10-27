import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();

test('Room writes expose only the canonical command adapter', () => {
  const { database } = createTestDatabase([]);
  assert({
    given: 'the public database adapter',
    should:
      'expose no legacy seat, prep or freeze path that bypasses Room policy and memberships',
    actual: ['seatRoomParticipant', 'startRoomPrep', 'startRound'].filter(
      (name) => name in database,
    ),
    expected: [],
  });
});
