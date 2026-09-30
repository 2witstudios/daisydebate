import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  NOW,
  liveRoom,
  openRoom,
} from '../../../features/lobby/room.test-support';
import { RoomTable } from './room-table';

setupRitewayBun();

const viewer = { rating: 1400 };

describe('RoomTable', () => {
  test('one row per room', () => {
    const html = renderToString(
      h(RoomTable, {
        rooms: [
          openRoom({ id: 'a', name: 'First' }),
          liveRoom({ id: 'b', name: 'Second' }),
        ],
        viewer,
        now: NOW,
        clearHref: '/lobby',
      }),
    );
    assert({
      given: 'an open table and a live room',
      should: 'render the column heads and one list item each',
      actual: [
        html.match(/<li /g)?.length,
        html.includes('Players · rating'),
        html.includes('First'),
        html.includes('Second'),
        html.includes('No rooms match'),
      ],
      expected: [2, true, true, true, false],
    });
  });

  test('empty', () => {
    const html = renderToString(
      h(RoomTable, {
        rooms: [],
        viewer,
        now: NOW,
        clearHref: '/lobby?tab=live',
      }),
    );
    assert({
      given: 'no rooms',
      should: 'say so and link Clear filters to the cleared query',
      actual: [
        html.includes('No rooms match these filters'),
        /<a [^>]*href="\/lobby\?tab=live"[^>]*>Clear filters<\/a>/.test(html),
        html.includes('<li '),
      ],
      expected: [true, true, false],
    });
  });
});
