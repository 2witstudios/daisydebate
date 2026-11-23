import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  accessibleWithin,
  renderAccessible,
  type AccessibleView,
} from '../../test-support/rendered/accessible';
import { postedBy } from '../test-support/posted-fields.test-support';
import { initialPresenceForm } from '../../features/presence/form';
import { ladderLine, ratingsLabel, ratingText } from './member-card';
import { LobbyViews } from './lobby-views';
import { rowDetail } from './people-rows';
import { person, rail } from './people-rail.test-support';
import { canBeChallenged } from './person-menu';
import { StatusForm } from './status-form';

setupRitewayBun();

/** Whether `first` comes before `second` in the document. */
const before = (first: Element, second: Element) =>
  (first.compareDocumentPosition(second) & 4) === 4;

/**
 * Each challenge card: the rail places one in the open list and one beside
 * the collapsed avatars, and CSS shows one of them.
 */
const challengeCards = (view: AccessibleView) =>
  view
    .all('region', 'Challenge from @mara')
    .map((card) => accessibleWithin(card));

test('an incoming challenge names its style and mode, and offers Accept (YChallenge)', () => {
  const cards = challengeCards(renderAccessible(rail([person()], 'youth')));
  assert({
    given: 'a ranked challenge from @mara in the member’s own lobby',
    should:
      'read Freestyle · Ranked with Accept and Decline, naming no division',
    actual: cards.map((card) => [
      card.textContent().includes('Freestyle · Ranked'),
      card.textContent().includes('Youth') ||
        card.textContent().includes('Open'),
      card.has('button', 'Accept'),
      card.has('button', 'Decline'),
    ]),
    expected: [
      [true, false, true, true],
      [true, false, true, true],
    ],
  });
});

describe('the people rail', () => {
  const view = renderAccessible(
    rail([
      person(),
      person({ username: 'bea', relation: 'friends', status: 'round' }),
      person({ username: 'cy', status: 'offline' }),
    ]),
  );
  const row = (name: string) => view.get('link', name);
  const section = (title: string) => view.get('heading', title, { level: 3 });
  test('the tabs and heading keep their word and number apart', () => {
    assert({
      given: 'three people online among ten listed',
      should:
        'count all listed on All and name the online count in the heading',
      actual: [
        view.within('group', 'Show').names('button'),
        view.within('group', 'Show').names('button', { pressed: true }),
        view.has('heading', 'People 3 online', { level: 2 }),
      ],
      expected: [['All 10', 'Friends 3'], ['All 10'], true],
    });
  });
  test('offline people sit below those online', () => {
    const bea = row('@bea, In a round, Freestyle Provisional');
    const ada = row('@ada, Online, Freestyle Provisional');
    const cy = row('@cy, Offline, Freestyle Provisional');
    assert({
      given: 'a friend in a Round, a stranger online and a stranger offline',
      should: 'section Friends, then Online, then Offline, naming each',
      actual: [
        before(section('Friends'), bea),
        before(bea, section('Online')),
        before(section('Online'), ada),
        before(ada, section('Offline')),
        before(section('Offline'), cy),
      ],
      expected: [true, true, true, true, true],
    });
  });
  test('a row works before any script', () => {
    assert({
      given: 'the server-rendered rail',
      should: 'link each row and its three dots to the profile, friends first',
      actual: [
        view.attribute('link', '@ada, Online, Freestyle Provisional', 'href'),
        view.attribute('link', 'Actions for @ada', 'href'),
        before(
          row('@bea, In a round, Freestyle Provisional'),
          row('@ada, Online, Freestyle Provisional'),
        ),
        postedBy(view, 'Collapse people list')['rail'],
        postedBy(view, 'Expand people list')['rail'],
      ],
      expected: ['/profile/ada', '/profile/ada', true, 'mini', 'open'],
    });
  });
  test('a row carries no action button of its own', () => {
    const controls = [...view.names('button'), ...view.names('link')];
    assert({
      given: 'a row',
      should:
        'keep Challenge and Add friend in the menu, so the rail stays narrow',
      actual: [
        view.has('button', 'Challenge'),
        controls.some((name) => name.includes('Add friend')) ||
          view.textContent().includes('Add friend'),
      ],
      expected: [false, false],
    });
  });
  test('an incoming challenge shows with both answers', () => {
    assert({
      given: 'a waiting challenge',
      should: 'name who and what, and offer Accept and Decline',
      actual: challengeCards(view).map((card) => [
        card.textContent().includes('Freestyle · Ranked'),
        card.has('button', 'Accept'),
        card.has('button', 'Decline'),
      ]),
      expected: [
        [true, true, true],
        [true, true, true],
      ],
    });
  });
  test('a screen reader hears the same ratings as anyone', () => {
    assert({
      given: 'a youth member rated provisionally, and one with no known ladder',
      should: 'name only their own ladder’s rating, else Unrated',
      actual: [
        ratingsLabel(person()),
        ratingsLabel(person({ division: null })),
      ],
      expected: ['Freestyle Provisional', 'Unrated'],
    });
  });
  test('a card shows the rating beside the status, inside one lobby (YChallenge)', () => {
    assert({
      given:
        'a provisional youth member seen from Youth and from Open, an Open member never rated, and one with no known ladder',
      should:
        'show the figure alone in the viewer’s own lobby, nothing across lobbies, and nothing where they have not played ranked',
      actual: [
        ladderLine(person(), 'youth'),
        ladderLine(person(), 'open'),
        ladderLine(person({ division: 'open' }), 'open'),
        ladderLine(person({ division: null }), 'open'),
      ],
      expected: ['1612*', null, null, null],
    });
  });
});

describe('a member who chose a display name and photo', () => {
  const photoId = 'f'.repeat(24);
  const view = renderAccessible(
    rail([person({ displayName: 'Ada Byron', photoId })]),
  );
  test('their row', () => {
    const name = 'Ada Byron (@ada), Online, Freestyle Provisional';
    assert({
      given: 'a member with a display name and published photo on the list',
      should:
        'name them by it with @username kept beside it, and show the small photo',
      actual: [
        view.get('link', name).firstElementChild?.textContent,
        view.get('link', name).lastElementChild?.textContent,
        view
          .within('complementary', 'People')
          .all('presentation')
          .map((image) => image.getAttribute('src'))
          .includes(`/api/profile-photos/${photoId}/128`),
      ],
      expected: ['Ada Byron', '@ada · Online', true],
    });
  });
});

describe('the people rail with no one to list', () => {
  test('the empty notice stays a list item', () => {
    const view = renderAccessible(rail([]));
    const status = view.get('status');
    assert({
      given: 'no one on the list',
      should: 'announce it inside a real list item, so the list stays valid',
      actual: [
        view.text('status'),
        status.parentElement !== null &&
          view.all('listitem').includes(status.parentElement),
        status.parentElement?.children.length,
      ],
      expected: ['No one matches', true, 1],
    });
  });
});

describe('row words', () => {
  test('a sent offer or request reads over the status', () => {
    assert({
      given: 'a sent challenge, a sent request, and neither',
      should: 'say so, else the status',
      actual: [
        rowDetail(person(), true),
        rowDetail(person({ relation: 'outgoing' }), false),
        rowDetail(person({ status: 'room' }), false),
      ],
      expected: ['Challenge sent', 'Friend request sent', 'In a room'],
    });
  });
  test('ratings read as figures or the shared words', () => {
    assert({
      given: 'established, provisional, unplayed and blinded',
      should: 'read as the account menu does',
      actual: [
        ratingText({
          ladder: { style: 'freestyle', division: 'open' },
          rating: 1500,
          provisional: false,
          hidden: false,
        }),
        ratingText({
          ladder: { style: 'freestyle', division: 'open' },
          rating: 1500,
          provisional: true,
          hidden: false,
        }),
        ratingText({
          ladder: { style: 'freestyle', division: 'open' },
          rating: null,
          provisional: false,
          hidden: false,
        }),
        ratingText({
          ladder: { style: 'freestyle', division: 'open' },
          rating: null,
          provisional: false,
          hidden: true,
        }),
      ],
      expected: ['1500', 'Provisional', 'Unrated', 'Hidden while judging'],
    });
  });
});

describe('canBeChallenged', () => {
  test('only someone free', () => {
    assert({
      given: 'each status a row can show',
      should: 'allow online and away only',
      actual: (
        ['online', 'away', 'busy', 'room', 'round', 'offline'] as const
      ).map((status) => canBeChallenged(person({ status }))),
      expected: [true, true, false, false, false, false],
    });
  });
});

describe('StatusForm', () => {
  test('one native button per choice, the current one pressed', () => {
    const view = renderAccessible(
      h(StatusForm, {
        action: async () => initialPresenceForm,
        chosen: 'busy',
      }),
    ).within('form', 'Status');
    const value = (name: string) => view.attribute('button', name, 'value');
    assert({
      given: 'a member who chose Busy',
      should: 'post each status as a button value, with Busy pressed',
      actual: [
        value('Online'),
        value('Appear offline'),
        view.attribute('button', 'Busy', 'value', { pressed: true }),
        view.names('button', { pressed: true }),
      ],
      expected: ['online', 'appearing_offline', 'busy', ['Busy']],
    });
  });
});

describe('LobbyViews', () => {
  test('the phone’s switch names everyone and counts who is online', () => {
    const view = renderAccessible(
      h(LobbyViews, {
        view: 'people',
        rooms: h('p', null, 'rooms'),
        people: h('p', null, 'people'),
        onlineCount: 3,
      }),
    );
    assert({
      given: 'three people online',
      should: 'label the switch People, stating the count as online',
      actual: view
        .within('navigation', 'Lobby views')
        .has('link', 'People · 3 online', { current: 'page' }),
      expected: true,
    });
  });

  test('the phone’s People view still names the page', () => {
    const view = renderAccessible(
      h(LobbyViews, {
        view: 'people',
        rooms: h('p', null, 'rooms'),
        people: h('p', null, 'people'),
        onlineCount: null,
      }),
    );
    const people = view
      .all('paragraph')
      .find((paragraph) => paragraph.textContent === 'people');
    assert({
      given: 'the Lobby opened on its People view',
      should: 'keep the Lobby heading above the list',
      actual:
        people !== undefined &&
        before(view.get('heading', 'Lobby', { level: 1 }), people),
      expected: true,
    });
  });
});
