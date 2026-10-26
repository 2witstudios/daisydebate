import { assert, setupRitewayBun, test } from 'riteway/bun';
import { activeRoomShown } from './active-room-bar';

setupRitewayBun();

test('the shell shows the way back only where the active Room is not already shown', () => {
  const roomId = 'm'.repeat(24);
  const live = {
    version: 1 as const,
    id: roomId,
    title: 'Current room',
    phase: 'live' as const,
    role: 'debater' as const,
    href: `/rounds/${'r'.repeat(24)}/room`,
  };
  assert({
    given: 'the Round room, the Room page, the lobby and another page',
    should: 'hide the bar on the first three and show it on the last',
    actual: [live.href, `/rooms/${roomId}`, '/lobby', '/profile'].map(
      (pathname) => activeRoomShown(pathname, live),
    ),
    expected: [true, true, true, false],
  });
});
