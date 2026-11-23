import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { AppShell } from './app-shell';
import type { ShellAccount, ShellRatings } from './account';
import type { RailPreference } from './rail-preference';
import type { ActiveRoomSummary } from '../../active-room/your-room';
import { renderInStore } from '../../test-support/render-in-store';
import {
  accessibleWithin,
  type AccessibleView,
} from '../../../test-support/rendered/accessible';

setupRitewayBun();

const member: ShellAccount = {
  state: 'member',
  username: 'ada-byron',
  displayName: null,
  photoId: null,
};

const roomHref = `/rooms/${'a'.repeat(24)}`;

/** The shell, read by role. */
const render = (
  account: ShellAccount = { state: 'anonymous' },
  activeRoom: ActiveRoomSummary | null = null,
  rail: RailPreference = 'extended',
  ratings: Promise<ShellRatings> | null = null,
): AccessibleView =>
  renderInStore(
    h(AppShell, {
      account,
      activeRoom,
      rail,
      ratings,
      toggleRail: async () => {},
      children: h('p', null, 'page'),
    }),
  );

/** The rail (the first Primary nav) and the phone tab bar (the second). */
const navs = (
  view: AccessibleView,
): readonly [AccessibleView, AccessibleView] => {
  const [rail, bar] = view.all('navigation', 'Primary');
  if (rail === undefined || bar === undefined)
    throw new Error('The shell did not render both Primary navs');
  return [accessibleWithin(rail), accessibleWithin(bar)];
};

const hrefsOf = (elements: readonly Element[]): readonly string[] =>
  elements.map((element) => element.getAttribute('href') ?? '');

/** Whether `first` comes before `second` in the document. */
const precedes = (first: Element, second: Element) =>
  // 4 is Node.DOCUMENT_POSITION_FOLLOWING: `second` follows `first`.
  (first.compareDocumentPosition(second) & 4) !== 0;

describe('AppShell', () => {
  test('owns the single main landmark beside one rail, with no top bar or side columns', () => {
    const view = render(member);
    const [rail] = view.all('navigation');
    assert({
      given: 'the shell for a member',
      should:
        'render the rail, one main and the phone tab bar, both navs named Primary, and no banner or complementary landmark',
      actual: [
        view.count('navigation'),
        view.count('navigation', 'Primary'),
        view.count('main'),
        view.count('banner'),
        view.count('complementary'),
        rail !== undefined && precedes(rail, view.get('main')),
      ],
      expected: [2, 2, 1, 0, 0, true],
    });
  });

  test('the rail shows words by default, with Minimize as a labeled row and More in the account menu (ADR 0091)', () => {
    const [extendedRail] = navs(render(member));
    const extended = [
      extendedRail.has('link', 'Home'),
      extendedRail.get('button', 'Minimize').closest('form') !== null,
      extendedRail.textContent().includes('More'),
    ];
    const [mini] = navs(render(member, null, 'mini'));
    assert({
      given: "a member's rail served extended and served mini",
      should:
        'name every destination in both, with Minimize as a form row in extended and Expand with its tooltip in mini, and no More control in the rail',
      actual: [
        ...extended,
        mini.has('link', 'Messages'),
        mini.attribute('button', 'Expand', 'title'),
      ],
      expected: [true, true, false, true, 'Expand'],
    });
  });

  test('places the page in the content column', () => {
    const view = render();
    assert({
      given: 'page content',
      should: 'render the page inside main',
      actual: view.within('main').text('paragraph'),
      expected: 'page',
    });
  });

  test('the rail: logo, destinations, then member places, with the account at the foot', () => {
    const [rail] = navs(render(member));
    assert({
      given: 'a member',
      should:
        'link home from the logo, then the destinations, then Notifications, Messages and Friends, then the account menu with the profile and account pages',
      actual: [
        rail.attribute('link', 'Daisy Debate home', 'href'),
        hrefsOf(rail.all('link')).filter(
          (href) => !['/help', '/about', '/terms', '/privacy'].includes(href),
        ),
      ],
      expected: [
        '/',
        [
          '/',
          '/',
          '/lobby',
          '/tournaments',
          '/leaderboard',
          '/watch',
          '/watch',
          '/recordings',
          '/judge',
          '/train',
          '/prep',
          '/notifications',
          '/messages',
          '/friends',
          '/profile/ada-byron',
          '/settings',
          '/analytics',
        ],
      ],
    });
  });

  test('the foot is the account menu: the avatar and username open a menu with the ratings and account pages', () => {
    const [rail] = navs(render(member));
    const foot = rail.within('group');
    assert({
      given: "a member's extended rail",
      should:
        'end the rail with the account menu, holding the account pages, analytics preferences and sign-out',
      actual: [
        foot.textContent().includes('ada-byron'),
        foot.attribute('link', 'Settings', 'href'),
        foot.attribute('link', 'Analytics preferences', 'href'),
        foot.get('button', 'Sign out').closest('form')?.getAttribute('action'),
      ],
      expected: [true, '/settings', '/analytics', '/auth/sign-out'],
    });
  });

  test('a member who chose a display name and photo', () => {
    const photoId = 'f'.repeat(24);
    const [rail, bar] = navs(
      render({ ...member, displayName: 'Ada Byron', photoId }),
    );
    const foot = rail.within('group');
    assert({
      given: 'a member with a display name and published photo',
      should:
        'name the account menu and phone sheet by it, keep @username visible beside it, and show the photo',
      actual: [
        foot.textContent().includes('Ada Byron'),
        foot.textContent().includes('@ada-byron'),
        foot
          .all('presentation')
          .map((photo) => photo.getAttribute('src'))
          .includes(`/api/profile-photos/${photoId}/128`),
        bar.textContent().includes('Ada Byron') &&
          bar.textContent().includes('ada-byron'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('every rail link has a name, counts included', () => {
    const [rail] = navs(render(member));
    assert({
      given: "a member's extended rail",
      should:
        'name every link, the full name when the word is shorter, and reach the help and legal pages',
      actual: [
        rail.has('link', 'Messages'),
        rail.has('link', /^Friends, \d+ online$/),
        ['/help', '/about', '/terms', '/privacy'].every((href) =>
          hrefsOf(rail.all('link')).includes(href),
        ),
      ],
      expected: [true, true, true],
    });
  });

  test('a visitor or someone mid sign-up gets the way in, not member places', () => {
    const [visitor] = navs(render());
    const visitorRail = [
      visitor.attribute('link', 'Sign in', 'href'),
      visitor.attribute('link', 'Sign in', 'title'),
      ['/messages', '/friends'].some((href) =>
        hrefsOf(visitor.all('link')).includes(href),
      ),
    ];
    const [provisional] = navs(render({ state: 'provisional' }));
    assert({
      given: 'an anonymous visitor and a provisional account',
      should:
        'end the rail with Sign in or Finish sign-up, and no Messages or Friends',
      actual: [
        ...visitorRail,
        provisional.attribute('link', 'Finish sign-up', 'href'),
      ],
      expected: ['/sign-in', 'Sign in', false, '/onboarding/username'],
    });
  });

  test('a visitor’s way in takes the foot, with no account menu', () => {
    const [visitor] = navs(render());
    const lastRule = visitor.all('separator').at(-1);
    assert({
      given: 'an anonymous visitor on the extended rail',
      should:
        'put the Sign in link at the foot, and no account menu or ratings',
      actual: [
        lastRule !== undefined &&
          precedes(lastRule, visitor.get('link', 'Sign in')),
        visitor.count('group'),
      ],
      expected: [true, 0],
    });
  });

  test('the phone tab bar: Home, Play, Judge, Inbox and More', () => {
    const tabsOf = (bar: AccessibleView) => {
      const sheet = bar.within('group').all('link');
      return hrefsOf(bar.all('link').filter((link) => !sheet.includes(link)));
    };
    const [, bar] = navs(render(member));
    const memberBar = [
      tabsOf(bar),
      bar.within('group').textContent().startsWith('More'),
    ];
    const [, visitorBar] = navs(render());
    assert({
      given: 'a member and a visitor on a phone',
      should:
        'offer four tab links and a More disclosure, Inbox for the member and Sign in for the visitor',
      actual: [memberBar[0], tabsOf(visitorBar), memberBar[1]],
      expected: [
        ['/', '/lobby', '/judge', '/messages'],
        ['/', '/lobby', '/judge', '/sign-in'],
        true,
      ],
    });
  });

  test('More on a phone reaches every destination the tabs leave out', () => {
    const [, bar] = navs(render(member));
    assert({
      given: "a member's More sheet",
      should: 'list their places, Settings and the help and legal pages',
      actual: hrefsOf(bar.within('list', 'More').all('link')),
      expected: [
        '/tournaments',
        '/leaderboard',
        '/watch',
        '/recordings',
        '/train',
        '/prep',
        '/notifications',
        '/friends',
        '/profile/ada-byron',
        '/settings',
        '/help',
        '/about',
        '/terms',
        '/privacy',
        '/analytics',
      ],
    });
  });

  test('a member in a Room sees the way back above the page', () => {
    const main = render(member, {
      id: 'a'.repeat(24),
      title: 'Tuesday night',
      phase: 'assembling',
      href: roomHref,
    }).within('main');
    const back = main.get('link', /^Return to room/);
    const inRoom = [
      precedes(back, main.get('paragraph')) &&
        back.getAttribute('href') === roomHref,
      main.textContent().includes('Return to room'),
    ];
    assert({
      given: 'a member holding an assembling Room, and one holding none',
      should:
        'open the main column with Return to room, and add nothing otherwise',
      actual: [
        ...inRoom,
        render(member).textContent().includes('Return to room'),
      ],
      expected: [true, true, false],
    });
  });
});

describe('Notifications', () => {
  test('a member reaches it from both navs', () => {
    const [rail, tabBar] = navs(render(member));
    assert({
      given: 'a member’s rail and phone More sheet',
      should: 'link /notifications from both',
      actual: [
        hrefsOf(rail.all('link')).includes('/notifications'),
        hrefsOf(tabBar.all('link')).includes('/notifications'),
      ],
      expected: [true, true],
    });
  });
});
