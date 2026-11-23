import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ActiveRoomBar, showsActiveRoomBar } from './active-room-bar';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { YourRoom, activeRoomPhaseLabel } from './your-room';

setupRitewayBun();

const roomId = 'a'.repeat(24);
const roomHref = `/rooms/${roomId}`;
const room = {
  id: roomId,
  title: 'Tuesday night',
  phase: 'assembling',
  href: roomHref,
} as const;

describe('activeRoomPhaseLabel', () => {
  test('names each phase', () => {
    assert({
      given: 'an assembling, ready and live Room',
      should:
        'read as the Room page does: Setting up, Ready to start, In progress',
      actual: (['assembling', 'ready', 'live'] as const).map(
        activeRoomPhaseLabel,
      ),
      expected: ['Setting up', 'Ready to start', 'In progress'],
    });
  });
});

describe('YourRoom', () => {
  test('pins the Room with one way back', () => {
    const view = renderAccessible(<YourRoom room={room} />).within(
      'region',
      'Your room',
    );
    assert({
      given: "the viewer's assembling Room",
      should: 'name it, its phase, and link Return to room as a document load',
      actual: [
        view.textContent().includes('Tuesday night'),
        view.textContent().includes('Setting up'),
        view.attribute('link', 'Return to room', 'href') === roomHref,
      ],
      expected: [true, true, true],
    });
  });
});

describe('showsActiveRoomBar', () => {
  test('hides where the Room is already pinned or open', () => {
    assert({
      given: 'Home, the Lobby, the Room page, a page under it and another page',
      should: 'show the bar only on the other page',
      actual: ['/', '/lobby', roomHref, `${roomHref}/edit`, '/watch'].map(
        (path) => showsActiveRoomBar(path, room),
      ),
      expected: [false, false, false, false, true],
    });
  });

  test('a live Room hides on its Round room and its Room page', () => {
    const live = { id: roomId, href: `/rounds/${'r'.repeat(24)}/room` };
    assert({
      given:
        'a live Room seen from its Round room, its Room page and another page',
      should: 'hide on the first two and show on the last',
      actual: [live.href, roomHref, '/profile'].map((path) =>
        showsActiveRoomBar(path, live),
      ),
      expected: [false, false, true],
    });
  });
});

describe('ActiveRoomBar', () => {
  test('links back to the Room with its title and phase', () => {
    const view = renderAccessible(
      <ActiveRoomBar room={{ ...room, phase: 'live' }} />,
    );
    const link = view.get('link', 'Return to room: Tuesday night, In progress');
    assert({
      given: 'a live Room rendered outside a page route',
      should: 'render one link to the Room naming it and In progress',
      actual: [
        view.count('link', undefined, { hidden: true }),
        link.getAttribute('href') === roomHref,
        view.text('link').includes('Tuesday night'),
        view.text('link').includes(' · In progress'),
        view.text('link').includes('Return to room'),
      ],
      expected: [1, true, true, true, true],
    });
  });
});
