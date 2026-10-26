import { assert, setupRitewayBun, test } from 'riteway/bun';
import { activeRoomHref, activeRoomReadSchema } from './active-room';

setupRitewayBun();

const roomId = 'a'.repeat(24);
const roundId = 'b'.repeat(24);
const entry = {
  version: 1,
  id: roomId,
  title: 'Tuesday night',
  phase: 'assembling',
  role: 'host',
  href: `/rooms/${roomId}`,
} as const;

test('the active room href names the page that holds the member', () => {
  assert({
    given: 'an assembling Room, a ready Room and a launched Round',
    should: 'send assembly to the Room and a live Round to its room page',
    actual: [
      activeRoomHref({ phase: 'assembling', roomId, roundId: null }),
      activeRoomHref({ phase: 'ready', roomId, roundId: null }),
      activeRoomHref({ phase: 'live', roomId, roundId }),
    ],
    expected: [
      `/rooms/${roomId}`,
      `/rooms/${roomId}`,
      `/rounds/${roundId}/room`,
    ],
  });
});

test('the active room read is a versioned, closed grammar', () => {
  assert({
    given: 'no active room, an assembling host and a live debater',
    should: 'accept each canonical read',
    actual: [
      { activeRoom: null },
      { activeRoom: entry },
      {
        activeRoom: {
          ...entry,
          phase: 'live',
          role: 'debater',
          href: `/rounds/${roundId}/room`,
        },
      },
    ].map((read) => activeRoomReadSchema.safeParse(read).success),
    expected: [true, true, true],
  });
  assert({
    given:
      'an unknown version, phase or role, an extra field, a foreign href and an href that disagrees with the phase',
    should: 'refuse rather than repair it',
    actual: [
      { ...entry, version: 2 },
      { ...entry, phase: 'started' },
      { ...entry, role: 'spectator' },
      { ...entry, seats: 2 },
      { ...entry, href: 'https://example.com/rooms/x' },
      { ...entry, href: `/rounds/${roundId}/room` },
      { ...entry, phase: 'live' },
    ].map(
      (activeRoom) => activeRoomReadSchema.safeParse({ activeRoom }).success,
    ),
    expected: Array(7).fill(false),
  });
});
