import { assert, setupRitewayBun, test } from 'riteway/bun';
import { eraseSeats, releaseRestrictedMember } from './room-assembly';
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

test('a restriction frees the seats and keeps the Room open for the others', () => {
  const room = state();
  const next = releaseRestrictedMember(room, 'other');
  assert({
    given: 'a ready Room whose Negative is restricted',
    should: 'free the seat, keep the host and leave the Room assembling',
    actual: [
      next.participants.map((p) => p.actorId),
      next.hostActorId,
      next.status,
    ],
    expected: [['host'], 'host', 'assembling'],
  });
});

test('a restricted host passes the Room to the first human still seated', () => {
  const next = releaseRestrictedMember(state(), 'host');
  const heir = state().participants.find((p) => p.actorId === 'other')!;
  assert({
    given: 'a ready Room whose host is restricted',
    should: 'free their seat, name the seated human host and stay open',
    actual: [
      next.participants.map((p) => p.actorId),
      next.hostActorId,
      next.hostLabel,
      next.status,
    ],
    expected: [['other'], 'other', heir.label, 'assembling'],
  });
});

test('a restricted host with no human left closes the Room', () => {
  const room = state();
  const onlyHost = {
    ...room,
    participants: room.participants.filter((p) => p.actorId === 'host'),
  };
  const withBot = {
    ...room,
    participants: room.participants.map((p) =>
      p.actorId === 'host' ? p : { ...p, kind: 'bot' as const },
    ),
  };
  assert({
    given: 'a host alone, and a host with only a bot seated',
    should: 'close the Room each time',
    actual: [
      releaseRestrictedMember(onlyHost, 'host').status,
      releaseRestrictedMember(withBot, 'host').status,
    ],
    expected: ['closed', 'closed'],
  });
});
