import { createElement as h, type ReactNode } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { AppShell } from './app-shell';
import { moreIsCurrent } from './components/tab-bar/tab-bar';
import type { ShellAccount } from './account';
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
  selfCard?: ReactNode,
): AccessibleView =>
  renderInStore(
    h(AppShell, {
      account,
      activeRoom,
      rail,
      ...(selfCard === undefined ? {} : { selfCard }),
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

  test('the rail shows words by default, with Minimize as a labeled row and More at the foot (ADR 0091)', () => {
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
        'name every destination in both, with Minimize as a form row in extended and Expand with its tooltip in mini, and More in the rail',
      actual: [
        ...extended,
        mini.has('link', 'Messages'),
        mini.attribute('button', 'Expand', 'title'),
      ],
      expected: [true, true, true, true, 'Expand'],
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

  test('the rail: logo, destinations, then member places, with More at the foot', () => {
    const [rail] = navs(render(member));
    assert({
      given: 'a member',
      should:
        'link home from the logo, then the destinations, then Notifications, Messages and Friends, then More with Settings',
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
          '/settings',
        ],
      ],
    });
  });

  test('the foot is More: Settings, Help & support, About Daisy, Sign out and the legal line', () => {
    const [rail] = navs(render(member));
    const foot = rail.within('group');
    assert({
      given: "a member's extended rail",
      should:
        'end the rail with More, holding the pages that are not destinations, sign-out and the legal pages, and nothing of the account itself',
      actual: [
        hrefsOf(foot.within('list', 'More').all('link')),
        hrefsOf(foot.within('list', 'Legal').all('link')),
        foot.get('button', 'Sign out').closest('form')?.getAttribute('action'),
        foot.textContent().includes('ada-byron'),
        foot.has('link', 'Contact support'),
        foot.has('link', 'Analytics preferences'),
      ],
      expected: [
        ['/settings', '/help', '/about'],
        ['/terms', '/privacy'],
        '/auth/sign-out',
        false,
        false,
        false,
      ],
    });
  });

  test('the phone sheet opens with the card it is handed', () => {
    const [, bar] = navs(
      render(member, null, 'extended', h('p', null, 'your card')),
    );
    const sheet = bar.within('group');
    assert({
      given: "a member's More sheet with their card",
      should: 'show the card before the links, then Sign out',
      actual: [
        precedes(sheet.get('paragraph'), sheet.get('list', 'More')),
        sheet.has('button', 'Sign out'),
      ],
      expected: [true, true],
    });
  });

  test('every rail link has a name, counts included', () => {
    const [rail] = navs(render(member));
    assert({
      given: "a member's extended rail",
      should:
        'name every link, the full name when the word is shorter, and reach Help and the legal pages, with support on Help',
      actual: [
        rail.has('link', 'Messages'),
        rail.has('link', /^Friends, \d+ online$/),
        ['/help', '/about', '/terms', '/privacy'].every((href) =>
          hrefsOf(rail.all('link')).includes(href),
        ),
        hrefsOf(rail.all('link')).includes('/support'),
      ],
      expected: [true, true, true, false],
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

  test('a visitor’s way in sits above More, which offers analytics in place of Settings', () => {
    const [visitor] = navs(render());
    const lastRule = visitor.all('separator').at(-1);
    const more = visitor.within('group');
    assert({
      given: 'an anonymous visitor on the extended rail',
      should:
        'put the Sign in link at the foot above More, whose pages give the analytics choice instead of Settings, with no sign-out',
      actual: [
        lastRule !== undefined &&
          precedes(lastRule, visitor.get('link', 'Sign in')),
        hrefsOf(more.within('list', 'More').all('link')),
        more.has('button', 'Sign out'),
      ],
      expected: [true, ['/analytics', '/help', '/about'], false],
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
      should:
        'list their places, Settings, Help and About, then the legal pages',
      actual: [
        ...hrefsOf(bar.within('list', 'More').all('link')),
        ...hrefsOf(bar.within('list', 'Legal').all('link')),
      ],
      expected: [
        '/tournaments',
        '/leaderboard',
        '/watch',
        '/recordings',
        '/train',
        '/prep',
        '/notifications',
        '/friends',
        '/settings',
        '/help',
        '/about',
        '/terms',
        '/privacy',
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

describe('moreIsCurrent', () => {
  test('More is the current tab on your own profile, not on someone else’s', () => {
    assert({
      given:
        'a member on their own profile, on a similar name’s, on Help, and a visitor on that profile',
      should:
        'light More for their own profile and Help, and not for another profile or a visitor',
      actual: [
        moreIsCurrent(member, '/profile/ada-byron'),
        moreIsCurrent(member, '/profile/ada-byronic'),
        moreIsCurrent(member, '/help'),
        moreIsCurrent({ state: 'anonymous' }, '/profile/ada-byron'),
      ],
      expected: [true, false, true, false],
    });
  });
});
