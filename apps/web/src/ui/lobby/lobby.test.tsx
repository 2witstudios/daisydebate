import { ladderCopyIn } from '../test-support/ladder-copy.test-support';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomListEntry, RoomListQuery } from '@daisy/protocol';
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
  formatLabel: 'Foundation',
  seatsTaken: 1,
  seatCount: 3,
  waitingSince: '2026-10-26T11:55:00.000Z',
  live: null,
  hostRating: 1712,
  lobbyId: id('o'),
  ageRule: 'adults',
  openJudgeSeats: 0,
};
const now = Date.parse('2026-10-26T12:00:00.000Z');
const query = (over: Partial<RoomListQuery> = {}): LobbyProps['query'] => ({
  q: '',
  pageSize: 20,
  ...over,
  lobbyId: over.lobbyId ?? id('o'),
});
const render = (props: Partial<LobbyProps> = {}) =>
  renderToStaticMarkup(
    <Lobby
      query={query()}
      rooms={[entry]}
      nextCursor={null}
      retry={false}
      activeRoom={null}
      now={now}
      viewer={{ actorId: id('d'), ageBand: 'adult' }}
      lobbies={[
        { id: id('o'), name: 'Open', ageRule: 'adults' },
        { id: id('y'), name: 'Youth', ageRule: 'under-18' },
      ]}
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
          visibility: 'public',
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
        new RegExp(`href="/watch/${id('d')}"[^>]*>Watch<`).test(html),
        html.indexOf('>Open</h2>') < html.indexOf('>Live now</h2>'),
        html.includes('>Ranked</span>'),
      ],
      expected: [true, true, true, true, true, true, true],
    });
  });

  test('the header leads to everything live', () => {
    assert({
      given: 'the Lobby header',
      should: 'link Watch live to the public hub',
      actual: render().includes(`href="/watch?lobby=${id('o')}"`),
      expected: true,
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
        new RegExp(
          `href="/play/room\\?lobby=${id('o')}"[^>]*>New room</a>`,
        ).test(html),
        /\btable\b/i.test(html),
      ],
      expected: [true, true, true, false],
    });
  });

  test('pins the viewer’s own Room first', () => {
    const roomHref = `/rooms/${id('e')}`;
    const html = render({
      activeRoom: {
        id: id('e'),
        title: 'My room',
        phase: 'ready',
        href: roomHref,
      },
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
      query: query({
        q: 'nothing',
        cursor: id('c'),
        status: 'live',
        mode: 'ranked',
      }),
      activeRoom: {
        id: id('f'),
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
      query: query({ q: 'tax', status: 'open', mode: 'ranked' }),
    });
    assert({
      given: 'an open tab with a search and a ranked filter',
      should: 'keep the lobby ID in the GET form, status links, and Clear',
      actual: [
        /<form[^>]*action="\/lobby"[^>]*method="get"/.test(html),
        html.includes('name="status" value="open"'),
        html.includes(`name="lobby" value="${id('o')}"`),
        html.includes(
          `href="/lobby?q=tax&amp;status=live&amp;mode=ranked&amp;lobby=${id('o')}"`,
        ),
        html.includes(`href="/lobby?status=open&amp;lobby=${id('o')}"`),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('the sort rides in the filter form and every Lobby link', () => {
    const html = render({
      query: query({ status: 'open', mode: 'ranked', sort: 'longest-waiting' }),
      nextCursor: id('f'),
    });
    assert({
      given: 'the open tab, ranked, sorted longest waiting, with a next page',
      should:
        'select Longest waiting in a Sort select beside the mode, and keep the sort on the tabs, Clear and the next page',
      actual: [
        /<select name="sort" aria-label="Sort rooms"/.test(html),
        /<option value="longest-waiting" selected="">Longest waiting<\/option>/.test(
          html,
        ),
        html.includes('<option value="newest">Newest</option>'),
        html.includes('<option value="closest'),
        html.indexOf('name="mode"') < html.indexOf('name="sort"'),
        html.includes(
          `href="/lobby?status=live&amp;mode=ranked&amp;lobby=${id('o')}&amp;sort=longest-waiting"`,
        ),
        html.includes(
          `href="/lobby?status=open&amp;lobby=${id('o')}&amp;sort=longest-waiting"`,
        ),
        html.includes(
          `href="/lobby?status=open&amp;mode=ranked&amp;lobby=${id('o')}&amp;sort=longest-waiting&amp;cursor=${id('f')}"`,
        ),
      ],
      expected: [true, true, true, false, true, true, true, true],
    });
  });

  test('Newest, the default order, is the sort select’s starting choice', () => {
    const html = render();
    assert({
      given: 'the Lobby with no sort in its URL',
      should: 'show Newest chosen and count no filter for it',
      actual: [
        /<option value="newest" selected="">Newest<\/option>/.test(html),
        html.includes('Clear'),
      ],
      expected: [true, false],
    });
  });

  test('the All tab adds no status to the search URL', () => {
    assert({
      given: 'the Lobby on its All tab',
      should: 'submit no hidden status field',
      actual: render().includes('name="status"'),
      expected: false,
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
          `href="/lobby?q=Stored+motion&amp;pageSize=1&amp;lobby=${id('o')}">First page`,
        ),
        html.includes(
          `href="/lobby?q=Stored+motion&amp;pageSize=1&amp;lobby=${id('o')}&amp;cursor=${id('a')}">Next page`,
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
        unmatched.includes(
          `href="/lobby?lobby=${id('o')}">Clear search and filters`,
        ),
        changed.includes('Rooms changed while you were paging.'),
        changed.includes(
          `href="/lobby?lobby=${id('o')}&amp;cursor=${id('f')}">Refresh`,
        ),
        changed.includes('Persisted room'),
      ],
      expected: [true, true, true, true, true, false],
    });
  });

  test('an empty later page says so', () => {
    const later = render({ rooms: [], query: query({ cursor: id('f') }) });
    assert({
      given: 'a later page with no Rooms',
      should: 'say No more rooms without a clear link',
      actual: [
        later.includes('No more rooms'),
        later.includes('Clear search and filters'),
      ],
      expected: [true, false],
    });
  });

  test('renders the returned page without narrowing it again', () => {
    const html = render({
      query: query({ status: 'live', mode: 'ranked' }),
      rooms: [entry],
    });
    assert({
      given: 'a live ranked query whose listing returned an open casual Room',
      should:
        'show the Room the listing returned, never filter the page itself',
      actual: [
        html.includes('Persisted room'),
        html.includes('No rooms match'),
      ],
      expected: [true, false],
    });
  });

  test('a row carries the listing facts and never the host rating', () => {
    const html = render();
    assert({
      given: 'an open Room waiting five minutes with a ranked host',
      should: 'show its format, seats and wait, and leave the rating out',
      actual: [
        html.includes('Foundation · 1 of 3 seats · Waiting 5 min'),
        html.includes('1712'),
      ],
      expected: [true, false],
    });
  });

  test('each action names its Room as one accessible name', () => {
    const html = render();
    assert({
      given: 'an open Room row',
      should:
        'label the link "Join: <title>", starting with its visible verb, with no hidden text a browser may space apart',
      actual: [
        /<a[^>]*aria-label="Join: Persisted room"[^>]*>Join<\/a>/.test(html),
        html.includes('class="sr-only">:'),
      ],
      expected: [true, false],
    });
  });

  test('Watch beside the seat action, and the other lobby’s Rooms (YLRowMatrix)', () => {
    const ranked = (over: Partial<RoomListEntry>): RoomListEntry => ({
      ...entry,
      competitionType: 'ranked',
      visibility: 'public',
      ...over,
    });
    const html = render({
      viewer: { actorId: id('d'), ageBand: 'adult' },
      query: query({ lobbyId: id('y') }),
      rooms: [
        ranked({ id: id('a'), title: 'Youth scrimmage', ageRule: 'under-18' }),
        ranked({
          id: id('c'),
          title: 'Judge wanted',
          ageRule: 'under-18',
          openJudgeSeats: 1,
        }),
      ],
    });
    assert({
      given: 'an adult browsing the Youth lobby',
      should:
        'offer Watch on every row, Judge where a judge seat is free, never Join, and no division label',
      actual: [
        /<a[^>]*aria-label="Watch: Youth scrimmage"[^>]*>Watch<\/a>/.test(html),
        /aria-label="Join: /.test(html),
        new RegExp(
          `href="/rooms/${id('c')}"[^>]*aria-label="Judge: Judge wanted"[^>]*>Judge</a>`,
        ).test(html),
        ladderCopyIn(html, { format: true }),
        html.includes('Freestyle</span>'),
      ],
      expected: [true, false, true, null, false],
    });
  });

  test('the lobby switch (YLLobbySwitch)', () => {
    const html = render({
      query: query({ lobbyId: id('y'), mode: 'ranked' }),
    });
    assert({
      given: 'the Youth lobby narrowed to ranked',
      should:
        'name the switch Lobby with no label inside, mark Youth current, link Open keeping the filters, and carry the lobby in the form',
      actual: [
        /<nav aria-label="Lobby"[^>]*><a[^>]*>Open<\/a><a[^>]*aria-current="page"[^>]*>Youth<\/a><\/nav>/.test(
          html,
        ),
        html.includes(`href="/lobby?mode=ranked&amp;lobby=${id('o')}"`),
        html.includes(`<input type="hidden" name="lobby" value="${id('y')}"/>`),
        /name="division"/.test(html),
      ],
      expected: [true, true, true, false],
    });
  });
});
