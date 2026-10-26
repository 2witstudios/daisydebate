import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { AppShell } from './app-shell';
import type { ShellAccount } from './account';
import type { ActiveRoomSummary } from '../../active-room/your-room';
import { occurrences, renderInStore } from '../../test-support/render-in-store';

setupRitewayBun();

const member: ShellAccount = { state: 'member', username: 'ada-byron' };

const roomHref = `/rooms/${'a'.repeat(24)}`;

const render = (
  account: ShellAccount = { state: 'anonymous' },
  activeRoom: ActiveRoomSummary | null = null,
): string =>
  renderInStore(
    h(AppShell, { account, activeRoom, children: h('p', null, 'page') }),
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
        'render the rail, one main and the phone tab bar, both navs named Primary, and no header, aside or collapse control',
      actual: [
        occurrences(html, '<nav'),
        (html.match(/<nav[^>]* aria-label="Primary"/g) ?? []).length,
        occurrences(html, '<main'),
        occurrences(html, '<header'),
        occurrences(html, '<aside'),
        /Collapse|Expand/.test(html),
        html.indexOf('<nav') < html.indexOf('<main'),
      ],
      expected: [2, 2, 1, 0, 0, false, true],
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

  test('the rail: logo, eight destinations and More, then the member places', () => {
    const [rail] = navs(render(member));
    assert({
      given: 'a member',
      should:
        'link home from the logo, then the destinations and More in order, then Messages, Notifications, Friends and the profile',
      actual: [
        rail.includes('aria-label="Daisy Debate home"'),
        hrefsOf(rail).filter(
          (href) =>
            !['/recordings', '/help', '/terms', '/privacy'].includes(href),
        ),
      ],
      expected: [
        true,
        [
          '/',
          '/',
          '/lobby',
          '/tournaments',
          '/leaderboard',
          '/watch',
          '/watch',
          '/judge',
          '/train',
          '/prep',
          '/settings',
          '/settings',
          '/messages',
          '/notifications',
          '/friends',
          '/profile/ada-byron',
        ],
      ],
    });
  });

  test('every rail link has a name, counts included', () => {
    const [rail] = navs(render(member));
    assert({
      given: "a member's rail",
      should:
        'name the icon links as screen-reader text, Friends with its online count, and the profile by username',
      actual: [
        rail.includes('<span class="sr-only">Messages</span>'),
        rail.includes('<span class="sr-only">Notifications</span>'),
        /<span class="sr-only">Friends, \d+ online<\/span>/.test(rail),
        rail.includes('aria-label="Your profile, ada-byron"'),
        rail.includes('<span class="sr-only">More</span>'),
        rail.includes('href="/recordings"'),
        ['/help', '/terms', '/privacy'].every((href) =>
          rail.includes(`href="${href}"`),
        ),
      ],
      expected: [true, true, true, true, true, true, true],
    });
  });

  test('a visitor or someone mid sign-up gets the way in, not member places', () => {
    const [visitor] = navs(render());
    const [provisional] = navs(render({ state: 'provisional' }));
    assert({
      given: 'an anonymous visitor and a provisional account',
      should:
        'end the rail with Sign in or Finish sign-up, and no Messages, Notifications or Friends',
      actual: [
        visitor.includes('href="/sign-in"'),
        visitor.includes('<span class="sr-only">Sign in</span>'),
        provisional.includes('href="/onboarding/username"'),
        ['/messages', '/notifications', '/friends'].some((href) =>
          visitor.includes(`href="${href}"`),
        ),
      ],
      expected: [true, true, true, false],
    });
  });

  test('the phone tab bar: Home, Play, Prep, Inbox and More', () => {
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
        ['/', '/lobby', '/prep', '/messages'],
        ['/', '/lobby', '/prep', '/sign-in'],
        true,
      ],
    });
  });

  test('More on a phone reaches every destination the tabs leave out', () => {
    const [, bar] = navs(render(member));
    const sheet = hrefsOf(bar.slice(bar.indexOf('<details')));
    assert({
      given: "a member's More sheet",
      should:
        'list the other destinations, Recordings, their places, Settings and the help and legal pages',
      actual: sheet,
      expected: [
        '/tournaments',
        '/leaderboard',
        '/watch',
        '/recordings',
        '/judge',
        '/train',
        '/notifications',
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
      title: 'Tuesday night',
      phase: 'assembling',
      href: roomHref,
    });
    const main = inRoom.slice(inRoom.indexOf('<main'));
    assert({
      given: 'a member holding an assembling Room, and one holding none',
      should: 'open the main column with Return to room, and add nothing otherwise',
      actual: [
        main.indexOf(`href="${roomHref}"`) < main.indexOf('<p>page</p>'),
        main.includes('Return to room'),
        render(member).includes('Return to room'),
      ],
      expected: [true, true, false],
    });
  });
});
