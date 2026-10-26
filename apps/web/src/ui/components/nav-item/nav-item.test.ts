import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { itemActive, matchesRoute } from './nav-item';

setupRitewayBun();

describe('matchesRoute', () => {
  test('is exact-only for the home route', () => {
    assert({
      given: 'the home href "/"',
      should: 'match only the root path, never a descendant',
      actual: [matchesRoute('/', '/'), matchesRoute('/lobby', '/')],
      expected: [true, false],
    });
  });

  test('matches a descendant of a non-root route', () => {
    assert({
      given: 'a settings href with a nested security route open',
      should: 'stay active on the descendant',
      actual: [
        matchesRoute('/settings', '/settings'),
        matchesRoute('/settings/security', '/settings'),
        matchesRoute('/settingsx', '/settings'),
      ],
      expected: [true, true, false],
    });
  });

  test('marks an item active on one of its sub-items', () => {
    const more = [
      { href: '/settings', label: 'Settings' },
      { href: '/help', label: 'Help' },
    ];
    assert({
      given: 'More with Help among its sub-items',
      should: 'be active on Help and its descendants, not elsewhere',
      actual: [
        itemActive('/help', '/settings', more),
        itemActive('/help/rules', '/settings', more),
        itemActive('/watch', '/settings', more),
      ],
      expected: [true, true, false],
    });
  });

  test('marks an item active on a route it also covers', () => {
    const play = ['/play', '/ranked'];
    assert({
      given: 'Play at the Lobby, also covering /play and /ranked',
      should: 'be active on those routes and their descendants, not elsewhere',
      actual: [
        itemActive('/lobby', '/lobby', [], play),
        itemActive('/play/room', '/lobby', [], play),
        itemActive('/ranked/host', '/lobby', [], play),
        itemActive('/prep', '/lobby', [], play),
      ],
      expected: [true, true, true, false],
    });
  });
});
