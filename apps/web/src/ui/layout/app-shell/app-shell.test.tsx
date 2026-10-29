import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { AppShell } from './app-shell';
import { notificationsDestination } from './components/destinations';
import { launchedPlaces } from '../../../features/coming-soon/launch';
import type { ShellAccount } from './account';
import type { RailPreference } from './rail-preference';
import type { ActiveRoomSummary } from '../../active-room/your-room';
import { occurrences, renderInStore } from '../../test-support/render-in-store';

setupRitewayBun();

const member: ShellAccount = { state: 'member', username: 'ada-byron' };

const roomHref = `/rooms/${'a'.repeat(24)}`;

const render = (
  account: ShellAccount = { state: 'anonymous' },
  activeRoom: ActiveRoomSummary | null = null,
  rail: RailPreference = 'extended',
): string =>
  renderInStore(
    h(AppShell, {
      account,
      activeRoom,
      rail,
      toggleRail: async () => {},
      children: h('p', null, 'page'),
    }),
  );

/** The markup of the rail (the first nav) or the tab bar (the second). */
const navs = (html: string): readonly [string, string] => {
  const [, rail = '', bar = ''] = html.split('<nav');
  return [rail, bar];
};

const hrefsOf = (html: string): readonly string[] =>
  [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1] ?? '');

describe('AppShell', () => {
  test('owns the single main landmark beside one rail, with no top bar or side columns', () => {
    const html = render(member);
    assert({
      given: 'the shell for a member',
      should:
        'render the rail, one main and the phone tab bar, both navs named Primary, and no header or aside',
      actual: [
        occurrences(html, '<nav'),
        (html.match(/<nav[^>]* aria-label="Primary"/g) ?? []).length,
        occurrences(html, '<main'),
        occurrences(html, '<header'),
        occurrences(html, '<aside'),
        html.indexOf('<nav') < html.indexOf('<main'),
      ],
      expected: [2, 2, 1, 0, 0, true],
    });
  });

  test('the rail shows words by default and names its collapse control (ADR 0091)', () => {
    const [extended] = navs(render(member));
    const [mini] = navs(render(member, null, 'mini'));
    assert({
      given: "a member's rail served extended and served mini",
      should:
        'carry every name as text at rail widths in extended and as screen-reader text in mini, with the toggle offering Minimize and Expand',
      actual: [
        extended.includes('<span class="max-rail:sr-only">Home</span>'),
        extended.includes('<span class="max-rail:sr-only">More</span>'),
        extended.includes('<form'),
        extended.includes('<span class="max-rail:sr-only">Minimize</span>'),
        mini.includes('<span class="sr-only">Messages</span>'),
        mini.includes('max-rail:sr-only'),
        mini.includes('<span class="sr-only">Expand</span>'),
        mini.includes('type="submit"'),
      ],
      expected: [true, true, true, true, true, false, true, true],
    });
  });

  test('places the page in the content column', () => {
    const html = render();
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    assert({
      given: 'page content',
      should: 'render the page inside main',
      actual: main.includes('<p>page</p>'),
      expected: true,
    });
  });

  test('the rail: logo, launched destinations and member places at the top, More and the profile at the foot', () => {
    const [rail] = navs(render(member));
    assert({
      given: 'a member',
      should:
        'link home from the logo, then the launched destinations, Messages and Friends, then More and the profile at the foot',
      actual: [
        rail.includes('aria-label="Daisy Debate home"'),
        hrefsOf(rail).filter(
          (href) => !['/help', '/terms', '/privacy'].includes(href),
        ),
      ],
      expected: [
        true,
        [
          '/',
          '/',
          '/lobby',
          '/leaderboard',
          '/judge',
          '/messages',
          '/friends',
          '/settings',
          '/settings',
          '/profile/ada-byron',
        ],
      ],
    });
  });

  test('the rail is pinned to the viewport at every height, so its foot stays at the bottom', () => {
    const [rail] = navs(render(member));
    const classes = rail.match(/class="([^"]*)"/)?.[1]?.split(' ') ?? [];
    assert({
      given: "a member's rail on any window height",
      should:
        'stick to the top and fill the viewport, never scroll with the page',
      actual: ['sticky', 'top-0', 'h-screen'].map((name) =>
        classes.includes(name),
      ),
      expected: [true, true, true],
    });
  });

  test('the rail foot is a plain group, with no divider above it', () => {
    const [rail] = navs(render(member));
    const foot = rail.slice(rail.lastIndexOf('<ul'));
    assert({
      given: "a member's rail",
      should: 'pin More and the profile to the foot without a border above',
      actual: [
        foot.includes('href="/settings"'),
        foot.includes('aria-label="Your profile, ada-byron"'),
        foot.includes('border-t'),
        foot.indexOf('href="/settings"') <
          foot.indexOf('aria-label="Your profile, ada-byron"'),
        /class="[^"]*\bbottom-0\b/.test(foot),
      ],
      expected: [true, true, false, true, true],
    });
  });

  test('every rail link has a name, counts included', () => {
    const [rail] = navs(render(member));
    assert({
      given: "a member's extended rail",
      should:
        'name every link — words at rail widths, the full name as screen-reader text when the word is shorter — and the profile by username',
      actual: [
        rail.includes('<span class="max-rail:sr-only">Messages</span>'),
        /<span class="sr-only">Friends, \d+ online<\/span>/.test(rail),
        rail.includes(
          '<span aria-hidden="true" class="max-rail:sr-only">Friends</span>',
        ),
        rail.includes('aria-label="Your profile, ada-byron"'),
        rail.includes('<span class="max-rail:sr-only">More</span>'),
        ['/help', '/terms', '/privacy'].every((href) =>
          rail.includes(`href="${href}"`),
        ),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('a visitor or someone mid sign-up gets the way in, not member places', () => {
    const [visitor] = navs(render());
    const [provisional] = navs(render({ state: 'provisional' }));
    assert({
      given: 'an anonymous visitor and a provisional account',
      should:
        'end the rail with Sign in or Finish sign-up, and no Messages or Friends',
      actual: [
        visitor.includes('href="/sign-in"'),
        visitor.includes('title="Sign in"'),
        visitor.includes('<span class="max-rail:sr-only">Sign in</span>'),
        provisional.includes('href="/onboarding/username"'),
        ['/messages', '/friends'].some((href) =>
          visitor.includes(`href="${href}"`),
        ),
      ],
      expected: [true, true, true, true, false],
    });
  });

  test('the phone tab bar: Home, Play, Judge, Inbox and More', () => {
    const [, bar] = navs(render(member));
    const [, visitorBar] = navs(render());
    const summary = bar.slice(bar.indexOf('<summary'));
    assert({
      given: 'a member and a visitor on a phone',
      should:
        'offer four tab links and a More disclosure, Inbox for the member and Sign in for the visitor',
      actual: [
        hrefsOf(bar.slice(0, bar.indexOf('<details'))),
        hrefsOf(visitorBar.slice(0, visitorBar.indexOf('<details'))),
        summary.includes('More'),
      ],
      expected: [
        ['/', '/lobby', '/judge', '/messages'],
        ['/', '/lobby', '/judge', '/sign-in'],
        true,
      ],
    });
  });

  test('More on a phone reaches every destination the tabs leave out', () => {
    const [, bar] = navs(render(member));
    const sheet = hrefsOf(bar.slice(bar.indexOf('<details')));
    assert({
      given: "a member's More sheet",
      should: 'list their places, Settings and the help and legal pages',
      actual: sheet,
      expected: [
        '/leaderboard',
        '/friends',
        '/profile/ada-byron',
        '/settings',
        '/help',
        '/terms',
        '/privacy',
      ],
    });
  });

  test('a member in a Room sees the way back above the page', () => {
    const inRoom = render(member, {
      id: 'a'.repeat(24),
      title: 'Tuesday night',
      phase: 'assembling',
      href: roomHref,
    });
    const main = inRoom.slice(inRoom.indexOf('<main'));
    assert({
      given: 'a member holding an assembling Room, and one holding none',
      should:
        'open the main column with Return to room, and add nothing otherwise',
      actual: [
        main.indexOf(`href="${roomHref}"`) < main.indexOf('<p>page</p>'),
        main.includes('Return to room'),
        render(member).includes('Return to room'),
      ],
      expected: [true, true, false],
    });
  });
});

describe('Notifications behind its launch flag (ISSUE-634)', () => {
  test('the nav lists Notifications only once it is launched', () => {
    const [rail, tabBar] = navs(render(member));
    assert({
      given:
        'the flag off and on, then a member’s rail and phone More sheet with the shipped flag',
      should:
        'offer Notifications only when launched, and link /notifications nowhere in the nav while it is not',
      actual: [
        notificationsDestination({ notifications: false }),
        notificationsDestination({ notifications: true })?.href,
        launchedPlaces.notifications,
        hrefsOf(rail).includes('/notifications'),
        hrefsOf(tabBar).includes('/notifications'),
      ],
      expected: [null, '/notifications', false, false, false],
    });
  });
});
