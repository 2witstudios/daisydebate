import { assert, setupRitewayBun, test } from 'riteway/bun';
import { eraseSeats } from './room-assembly';
import { state } from './room-assembly.test-support';

setupRitewayBun();

test('erasing a seated player leaves the Room as if they had left', () => {
  const room = state();
  const next = eraseSeats(room, 'other');
  assert({
    given: 'a ready Room whose Negative is erased',
    should:
      'remove their seat, return to assembling, bump the version and ask the rest to ready again',
    actual: [
      next.participants.map((p) => [p.actorId, p.consentCommandId]),
      next.status,
      next.version - room.version,
    ],
    expected: [[['host', null]], 'assembling', 1],
  });
});

test('erasing someone without a seat changes only the version', () => {
  const room = { ...state(), status: 'started' as const };
  assert({
    given: 'a started Room and an actor who never sat in it',
    should: 'keep every seat and the status',
    actual: [
      eraseSeats(room, 'nobody').participants.length,
      eraseSeats(room, 'nobody').status,
    ],
    expected: [2, 'started'],
  });
});
