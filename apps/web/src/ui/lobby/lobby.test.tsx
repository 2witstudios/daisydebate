import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { listRooms } from '../../features/lobby/list-rooms';
import { defaultQuery, type LobbyQuery } from '../../features/lobby/query';
import { NOW } from '../../features/lobby/room.test-support';
import { Lobby } from './lobby';

setupRitewayBun();

const render = (query: LobbyQuery) =>
  renderToString(h(Lobby, { listing: listRooms(query, NOW), query, now: NOW }));

describe('Lobby', () => {
  test('the default page', () => {
    const html = render(defaultQuery);
    assert({
      given: 'the default lobby',
      should:
        'have one h1, the viewer rating, both header actions and eight rows',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('Your rating 1400'),
        /href="\/ranked"[^>]*>Find a match</.test(html),
        /href="\/play\/room"[^>]*>Open a table</.test(html),
        html.match(/<li class="[^"]*border-t/g)?.length,
        html.includes('Tuesday night, no mercy'),
      ],
      expected: [1, true, true, true, 8, true],
    });
  });

  test('a ranked table the viewer cannot take', () => {
    const html = render({ ...defaultQuery, tab: 'open' });
    assert({
      given: 'the open tab at rating 1400',
      should:
        'disable Take seat for the 1600–1800 and 1300–1700-excluded ranked tables only',
      actual: html.match(/<button [^>]*disabled=""/g)?.length,
      // Top of the ladder (1600–1800) excludes 1400; Tuesday (1300–1700) and
      // Quarterfinal (1200–1400, inclusive edge) take the viewer.
      expected: 1,
    });
  });

  test('filters that match nothing', () => {
    const html = render({ ...defaultQuery, q: 'zzz' });
    assert({
      given: 'a search with no match',
      should: 'show the empty state with 0 rooms counted',
      actual: [
        html.includes('No rooms match these filters'),
        html.includes('0 rooms'),
      ],
      expected: [true, true],
    });
  });
});
