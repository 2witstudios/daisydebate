import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { lobbyDestinations, roomAction } from './actions';
import { liveRoom, openRoom } from './room.test-support';

setupRitewayBun();

describe('roomAction', () => {
  test('an open table the viewer fits', () => {
    assert({
      given: 'an open table with room for the viewer',
      should: 'offer an enabled take-seat action',
      actual: roomAction(openRoom(), { rating: 1500 }),
      expected: {
        kind: 'take-seat',
        href: lobbyDestinations.takeSeat,
        enabled: true,
      },
    });
  });

  test('a ranked table whose band excludes the viewer', () => {
    assert({
      given: 'a ranked table accepting 1600–1800 and a 1400 viewer',
      should: 'offer a disabled take-seat action',
      actual: roomAction(
        openRoom({ mode: 'ranked', band: { min: 1600, max: 1800 } }),
        { rating: 1400 },
      ),
      expected: {
        kind: 'take-seat',
        href: lobbyDestinations.takeSeat,
        enabled: false,
      },
    });
  });

  test('a live room', () => {
    assert({
      given: 'a live room, whatever the viewer rating',
      should: 'offer an enabled spectate action',
      actual: roomAction(liveRoom(), { rating: 1 }),
      expected: {
        kind: 'spectate',
        href: lobbyDestinations.spectate,
        enabled: true,
      },
    });
  });
});

describe('lobbyDestinations', () => {
  test('every action points at an existing route', () => {
    assert({
      given: 'no backend operations yet',
      should: 'point each lobby action at its nearest existing route',
      actual: lobbyDestinations,
      expected: {
        findMatch: '/ranked',
        openTable: '/play',
        takeSeat: '/play',
        spectate: '/watch',
      },
    });
  });
});
