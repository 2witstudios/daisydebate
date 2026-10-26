import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomListEntry } from '@daisy/protocol';
import {
  defaultLobbyFilters,
  type LobbyQuery,
} from '../../features/lobby/discovery-query';
import { Lobby, type LobbyProps } from './lobby';
setupRitewayBun();

const id = (c: string) => c.repeat(24);
const entry: RoomListEntry = {
  id: id('a'),
  version: 1,
  title: 'Persisted room',
  topic: 'Persisted debate topic',
  visibility: 'unlisted',
  hostActorId: id('b'),
  hostLabel: 'Host member',
  status: 'assembling',
  competitionType: 'casual',
  seated: false,
  roundRef: null,
};
const query = (over: Partial<LobbyQuery['list']> = {}): LobbyQuery => ({
  list: { q: '', pageSize: 20, ...over },
  filters: defaultLobbyFilters,
});
const render = (props: Partial<LobbyProps> = {}) =>
  renderToStaticMarkup(
    <Lobby
      query={query()}
      rooms={[entry]}
      nextCursor={null}
      retry={false}
      activeRoom={null}
      {...props}
    />,
  );

describe('Lobby', () => {
  test('one compact row per Room: name, host and facts, then one action', () => {
    const html = render({
      rooms: [
        entry,
        {
          ...entry,
          id: id('c'),
          title: 'Live round',
          status: 'started',
          competitionType: 'ranked',
          roundRef: { id: id('d'), status: 'active' },
        },
      ],
    });
    assert({
      given: 'an open casual Room and a live ranked Round',
      should:
        'show both rows with their host, topic and one verb each, grouped Open then Live now',
      actual: [
        html.includes('Persisted room'),
        html.includes('Host member · '),
        html.includes('Persisted debate topic'),
        new RegExp(`href="/rooms/${id('a')}"[^>]*>Join<`).test(html),
        new RegExp(`href="/rounds/${id('d')}"[^>]*>Watch<`).test(html),
        html.indexOf('>Open</h2>') < html.indexOf('>Live now</h2>'),
        html.includes('>Ranked</span>'),
      ],
      expected: [true, true, true, true, true, true, true],
    });
  });

  test('Play opens over the Lobby and New room starts one', () => {
    const html = render();
    assert({
      given: 'the Lobby header',
      should:
        'offer Play as a link to /play that opens the choices, and New room to the room form',
      actual: [
        /<a[^>]*href="\/play"[^>]*aria-haspopup="dialog"[^>]*>Play<\/a>/.test(
          html,
        ),
        html.includes('Practice with a bot'),
        /href="\/play\/room"[^>]*>New room<\/a>/.test(html),
        /\btable\b/i.test(html),
      ],
      expected: [true, true, true, false],
    });
  });

  test('pins the viewer’s own Room first', () => {
    const roomHref = `/rooms/${id('e')}`;
    const html = render({
      activeRoom: { title: 'My room', phase: 'ready', href: roomHref },
    });
    assert({
      given: 'a viewer with an active Room',
      should: 'show it above the filters with Return to room',
      actual: [
        html.indexOf('My room') < html.indexOf('Filter rooms'),
        new RegExp(`href="${roomHref}"[^>]*>Return to room</a>`).test(html),
      ],
      expected: [true, true],
    });
  });

  test('an unlisted Room still gets its return card on any page', () => {
    const roomHref = `/rooms/${id('f')}`;
    const html = render({
      rooms: [],
      nextCursor: 'later',
      query: {
        list: { q: 'nothing', pageSize: 20, cursor: 'page-3' },
        filters: { status: 'live', mode: 'ranked' },
      },
      activeRoom: {
        title: 'Private room',
        phase: 'assembling',
        href: roomHref,
      },
    });
    assert({
      given:
        'a member whose Room is not in the listing, on a later, filtered and empty page',
      should: 'still pin the Room with Return to room',
      actual: [
        html.includes('Private room'),
        new RegExp(`href="${roomHref}"[^>]*>Return to room</a>`).test(html),
      ],
      expected: [true, true],
    });
  });

  test('filters are one GET form that keeps the status tab', () => {
    const html = render({
      query: {
        list: { q: 'tax', pageSize: 20 },
        filters: { ...defaultLobbyFilters, status: 'open', mode: 'ranked' },
      },
    });
    assert({
      given: 'an open tab with a search and a ranked filter',
      should: 'post nowhere, carry the tab, and link the other tabs and Clear',
      actual: [
        /<form[^>]*action="\/lobby"[^>]*method="get"/.test(html),
        html.includes('name="status" value="open"'),
        html.includes('href="/lobby?q=tax&amp;status=live&amp;mode=ranked"'),
        html.includes('href="/lobby?status=open"'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('pages forward and back with the filters kept', () => {
    const html = render({
      query: query({ q: 'Stored motion', pageSize: 1, cursor: id('f') }),
      nextCursor: id('a'),
    });
    assert({
      given: 'a later page with more after it',
      should: 'link First page and Next page carrying search and page size',
      actual: [
        html.includes(
          'href="/lobby?q=Stored+motion&amp;pageSize=1">First page',
        ),
        html.includes(
          `href="/lobby?q=Stored+motion&amp;pageSize=1&amp;cursor=${id('a')}">Next page`,
        ),
      ],
      expected: [true, true],
    });
  });

  test('empty, unmatched and changed pages each say so', () => {
    const [empty, unmatched, changed] = [
      render({ rooms: [] }),
      render({ rooms: [], query: query({ q: 'missing' }) }),
      render({ retry: true, query: query({ cursor: id('f') }) }),
    ];
    assert({
      given: 'no Rooms, a search with no match, and a race while paging',
      should:
        'offer New room, Clear search and filters, then Refresh this page',
      actual: [
        empty.includes('No open rooms right now'),
        unmatched.includes('No rooms match'),
        unmatched.includes('href="/lobby">Clear search and filters'),
        changed.includes('Rooms changed while you were paging.'),
        changed.includes(`href="/lobby?cursor=${id('f')}">Refresh`),
        changed.includes('Persisted room'),
      ],
      expected: [true, true, true, true, true, false],
    });
  });

  test('an empty later page and a filter that empties one page say so', () => {
    const later = render({ rooms: [], query: query({ cursor: id('f') }) });
    const filtered = render({
      nextCursor: id('a'),
      query: {
        list: { q: '', pageSize: 20 },
        filters: { ...defaultLobbyFilters, mode: 'ranked' },
      },
    });
    assert({
      given:
        'a later page with no Rooms, and a ranked filter on a casual page with more after it',
      should:
        'say No more rooms without a clear link, then that nothing on this page matches',
      actual: [
        later.includes('No more rooms'),
        later.includes('Clear search and filters'),
        filtered.includes('No rooms on this page match'),
      ],
      expected: [true, false, true],
    });
  });

  test('each action names its Room for a screen reader', () => {
    assert({
      given: 'an open Room row',
      should: 'add the Room title to the link as screen-reader text',
      actual: render().includes(
        '>Join<span class="sr-only">: Persisted room</span></a>',
      ),
      expected: true,
    });
  });
});
