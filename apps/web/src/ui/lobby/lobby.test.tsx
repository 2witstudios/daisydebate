import { ladderCopyInView } from '../test-support/ladder-copy.test-support';
import { playOptionsFor } from '../../features/play/options';
import { instantMs } from '@daisy/clock';
import {
  renderAccessible,
  type AccessibleView,
} from '../../test-support/rendered/accessible';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type {
  RoomListEntry,
  RoomListQuery,
} from '@daisy/protocol/room-contract';
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
const now = instantMs('2026-10-26T12:00:00.000Z');
const query = (over: Partial<RoomListQuery> = {}): LobbyProps['query'] => ({
  q: '',
  pageSize: 20,
  ...over,
  lobbyId: over.lobbyId ?? id('o'),
});
/** Node.DOCUMENT_POSITION_FOLLOWING; the DOM globals are not installed here. */
const DOCUMENT_POSITION_FOLLOWING = 4;
/** Whether `later` comes after `earlier` in the page. */
const follows = (earlier: Element, later: Element) =>
  Boolean(earlier.compareDocumentPosition(later) & DOCUMENT_POSITION_FOLLOWING);
/** The fields the filter form submits, hidden ones included. */
const filterFields = (view: AccessibleView) => {
  const form = (view.get('button', 'Apply') as HTMLButtonElement).form;
  return [...(form?.elements ?? [])]
    .map((field) => field as HTMLInputElement)
    .filter((field) => field.name !== '')
    .map((field) => `${field.name}=${field.value}`);
};
const render = (props: Partial<LobbyProps> = {}) =>
  renderAccessible(
    <Lobby
      query={query()}
      rooms={[entry]}
      nextCursor={null}
      retry={false}
      activeRoom={null}
      now={now}
      viewer={{ actorId: id('d'), ageBand: 'adult' }}
      playOptions={playOptionsFor(true)}
      lobbies={[
        { id: id('o'), name: 'Open', ageRule: 'adults' },
        { id: id('y'), name: 'Youth', ageRule: 'under-18' },
      ]}
      {...props}
    />,
  );

describe('Lobby', () => {
  test('one compact row per Room: name, host and facts, then one action', () => {
    const view = render({
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
        view.textContent().includes('Persisted room'),
        view.textContent().includes('Host member · '),
        view.textContent().includes('Persisted debate topic'),
        [
          view.attribute('link', 'Join: Persisted room', 'href'),
          view.text('link', 'Join: Persisted room'),
        ],
        [
          view.attribute('link', 'Watch: Live round', 'href'),
          view.text('link', 'Watch: Live round'),
        ],
        view
          .names('heading', { level: 2 })
          .filter((name) => ['Open', 'Live now'].includes(name)),
        view.within('region', 'Live now').textContent().includes('Ranked'),
      ],
      expected: [
        true,
        true,
        true,
        [`/rooms/${id('a')}`, 'Join'],
        [`/watch/${id('d')}`, 'Watch'],
        ['Open', 'Live now'],
        true,
      ],
    });
  });

  test('the header leads to everything live', () => {
    assert({
      given: 'the Lobby header',
      should: 'link Watch live to the public hub',
      actual: render().attribute('link', 'Watch live', 'href'),
      expected: `/watch?lobby=${id('o')}`,
    });
  });

  test('Play opens over the Lobby and New room starts one', () => {
    const view = render();
    assert({
      given: 'the Lobby header',
      should:
        'offer Play as a link to /play that opens the choices, and New room to the room form',
      actual: [
        [
          view.attribute('link', 'Play', 'href'),
          view.attribute('link', 'Play', 'aria-haspopup'),
        ],
        view.textContent().includes('Practice with a bot'),
        view.attribute('link', 'New room', 'href'),
        view.count('table', undefined, { hidden: true }),
      ],
      expected: [['/play', 'dialog'], true, `/play/room?lobby=${id('o')}`, 0],
    });
  });

  test('pins the viewer’s own Room first', () => {
    const roomHref = `/rooms/${id('e')}`;
    const view = render({
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
        view.textContent().includes('My room') &&
          follows(
            view.get('link', 'Return to room'),
            view.get('search', 'Filter rooms'),
          ),
        view.attribute('link', 'Return to room', 'href'),
      ],
      expected: [true, roomHref],
    });
  });

  test('an unlisted Room still gets its return card on any page', () => {
    const roomHref = `/rooms/${id('f')}`;
    const view = render({
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
        view.textContent().includes('Private room'),
        view.attribute('link', 'Return to room', 'href'),
      ],
      expected: [true, roomHref],
    });
  });

  test('filters are one GET form that keeps the status tab', () => {
    const view = render({
      query: query({ q: 'tax', status: 'open', mode: 'ranked' }),
    });
    const tabs = view.within('navigation', 'Room status');
    assert({
      given: 'an open tab with a search and a ranked filter',
      should: 'keep the lobby ID in the GET form, status links, and Clear',
      actual: [
        [
          view.attribute('search', 'Filter rooms', 'action'),
          view.attribute('search', 'Filter rooms', 'method'),
        ],
        filterFields(view).includes('status=open'),
        filterFields(view).includes(`lobby=${id('o')}`),
        tabs.attribute('link', 'Live', 'href'),
        view.attribute('link', 'Clear', 'href'),
      ],
      expected: [
        ['/lobby', 'get'],
        true,
        true,
        `/lobby?q=tax&status=live&mode=ranked&lobby=${id('o')}`,
        `/lobby?status=open&lobby=${id('o')}`,
      ],
    });
  });

  test('the sort rides in the filter form and every Lobby link', () => {
    const view = render({
      query: query({ status: 'open', mode: 'ranked', sort: 'longest-waiting' }),
      nextCursor: id('f'),
    });
    const sort = view.get('combobox', 'Sort rooms') as HTMLSelectElement;
    const options = [...sort.options].map(
      ({ value, text, selected }) => `${value}:${text}${selected ? '*' : ''}`,
    );
    assert({
      given: 'the open tab, ranked, sorted longest waiting, with a next page',
      should:
        'select Longest waiting in a Sort select beside the mode, and keep the sort on the tabs, Clear and the next page',
      actual: [
        sort.name,
        options.includes('longest-waiting:Longest waiting*'),
        options.includes('newest:Newest'),
        options.some((option) => option.startsWith('closest')),
        view.attribute('combobox', 'Ranked or casual', 'name') === 'mode' &&
          follows(view.get('combobox', 'Ranked or casual'), sort),
        view
          .within('navigation', 'Room status')
          .attribute('link', 'Live', 'href'),
        view.attribute('link', 'Clear', 'href'),
        view.attribute('link', 'Next page', 'href'),
      ],
      expected: [
        'sort',
        true,
        true,
        false,
        true,
        `/lobby?status=live&mode=ranked&lobby=${id('o')}&sort=longest-waiting`,
        `/lobby?status=open&lobby=${id('o')}&sort=longest-waiting`,
        `/lobby?status=open&mode=ranked&lobby=${id('o')}&sort=longest-waiting&cursor=${id('f')}`,
      ],
    });
  });

  test('Newest, the default order, is the sort select’s starting choice', () => {
    const view = render();
    const sort = view.get('combobox', 'Sort rooms') as HTMLSelectElement;
    assert({
      given: 'the Lobby with no sort in its URL',
      should: 'show Newest chosen and count no filter for it',
      actual: [
        [sort.value, sort.selectedOptions[0]?.text],
        view.textContent().includes('Clear'),
      ],
      expected: [['newest', 'Newest'], false],
    });
  });

  test('the All tab adds no status to the search URL', () => {
    assert({
      given: 'the Lobby on its All tab',
      should: 'submit no hidden status field',
      actual: filterFields(render()).some((field) =>
        field.startsWith('status='),
      ),
      expected: false,
    });
  });

  test('pages forward and back with the filters kept', () => {
    const view = render({
      query: query({ q: 'Stored motion', pageSize: 1, cursor: id('f') }),
      nextCursor: id('a'),
    });
    assert({
      given: 'a later page with more after it',
      should: 'link First page and Next page carrying search and page size',
      actual: [
        view.attribute('link', 'First page', 'href'),
        view.attribute('link', 'Next page', 'href'),
      ],
      expected: [
        `/lobby?q=Stored+motion&pageSize=1&lobby=${id('o')}`,
        `/lobby?q=Stored+motion&pageSize=1&lobby=${id('o')}&cursor=${id('a')}`,
      ],
    });
  });

  test('empty, unmatched and changed pages each say so', () => {
    // Each render replaces the last one's output, so read each before the next.
    const empty = render({ rooms: [] }).textContent();
    const unmatchedView = render({
      rooms: [],
      query: query({ q: 'missing' }),
    });
    const unmatched = {
      text: unmatchedView.textContent(),
      clear: unmatchedView.attribute(
        'link',
        'Clear search and filters',
        'href',
      ),
    };
    const changedView = render({
      retry: true,
      query: query({ cursor: id('f') }),
    });
    const changed = {
      text: changedView.textContent(),
      refresh: changedView.attribute('link', /^Refresh/, 'href'),
    };
    assert({
      given: 'no Rooms, a search with no match, and a race while paging',
      should:
        'offer New room, Clear search and filters, then Refresh this page',
      actual: [
        empty.includes('No open rooms right now'),
        unmatched.text.includes('No rooms match'),
        unmatched.clear,
        changed.text.includes('Rooms changed while you were paging.'),
        changed.refresh,
        changed.text.includes('Persisted room'),
      ],
      expected: [
        true,
        true,
        `/lobby?lobby=${id('o')}`,
        true,
        `/lobby?lobby=${id('o')}&cursor=${id('f')}`,
        false,
      ],
    });
  });

  test('an empty later page says so', () => {
    const later = render({
      rooms: [],
      query: query({ cursor: id('f') }),
    }).textContent();
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
    const text = render({
      query: query({ status: 'live', mode: 'ranked' }),
      rooms: [entry],
    }).textContent();
    assert({
      given: 'a live ranked query whose listing returned an open casual Room',
      should:
        'show the Room the listing returned, never filter the page itself',
      actual: [
        text.includes('Persisted room'),
        text.includes('No rooms match'),
      ],
      expected: [true, false],
    });
  });

  test('a row carries the listing facts and never the host rating', () => {
    const text = render().textContent();
    assert({
      given: 'an open Room waiting five minutes with a ranked host',
      should: 'show its format, seats and wait, and leave the rating out',
      actual: [
        text.includes('Foundation · 1 of 3 seats · Waiting 5 min'),
        text.includes('1712'),
      ],
      expected: [true, false],
    });
  });

  test('each action names its Room as one accessible name', () => {
    const view = render();
    assert({
      given: 'an open Room row',
      should:
        'label the link "Join: <title>", starting with its visible verb, with no hidden text a browser may space apart',
      actual: [
        view.attribute('link', 'Join: Persisted room', 'aria-label'),
        // The link's whole text, hidden text included, is the visible verb.
        view.text('link', 'Join: Persisted room'),
      ],
      expected: ['Join: Persisted room', 'Join'],
    });
  });

  test('Watch beside the seat action, and the other lobby’s Rooms (YLRowMatrix)', () => {
    const ranked = (over: Partial<RoomListEntry>): RoomListEntry => ({
      ...entry,
      competitionType: 'ranked',
      visibility: 'public',
      ...over,
    });
    const view = render({
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
        view.text('link', 'Watch: Youth scrimmage'),
        view.names('link').some((name) => name.startsWith('Join: ')),
        [
          view.attribute('link', 'Judge: Judge wanted', 'href'),
          view.text('link', 'Judge: Judge wanted'),
        ],
        ladderCopyInView(view, { format: true }),
        view.textContent().includes('Freestyle'),
      ],
      expected: ['Watch', false, [`/rooms/${id('c')}`, 'Judge'], null, false],
    });
  });

  test('the lobby switch (YLLobbySwitch)', () => {
    const view = render({
      query: query({ lobbyId: id('y'), mode: 'ranked' }),
    });
    const lobbies = view.within('navigation', 'Lobby');
    assert({
      given: 'the Youth lobby narrowed to ranked',
      should:
        'name the switch Lobby with no label inside, mark Youth current, link Open keeping the filters, and carry the lobby in the form',
      actual: [
        [
          lobbies.names('link'),
          lobbies.textContent(),
          lobbies.has('link', 'Youth', { current: 'page' }),
          lobbies.has('link', 'Open', { current: false }),
        ],
        lobbies.attribute('link', 'Open', 'href'),
        filterFields(view).includes(`lobby=${id('y')}`),
        filterFields(view).some((field) => field.startsWith('division=')),
      ],
      expected: [
        [['Open', 'Youth'], 'OpenYouth', true, true],
        `/lobby?mode=ranked&lobby=${id('o')}`,
        true,
        false,
      ],
    });
  });
});
