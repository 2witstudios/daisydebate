import { ladderCopyIn } from '../test-support/ladder-copy.test-support';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Dashboard } from './dashboard';
import { HeroBanner } from './hero-banner/hero-banner';
import { LiveNow } from './live-now/live-now';
import { tiles } from './tiles';
import { initialLinkForm } from '../auth/request-link';
import { occurrences, renderInStore } from '../test-support/render-in-store';

setupRitewayBun();

const renderWithGlance = (): string =>
  renderInStore(
    h(Dashboard, {
      audience: 'member',
      hero: null,
      liveNow: null,
      seasonGlance: { number: 7, line: '12 days left' },
    }),
  );

const render = (): string =>
  renderInStore(
    h(Dashboard, {
      audience: 'visitor',
      hero: h(HeroBanner, {
        requestLink: () => Promise.resolve(initialLinkForm),
      }),
      liveNow: h(LiveNow, { rounds: [] }),
    }),
  );

describe('Dashboard', () => {
  test('links every configured destination from a named list', () => {
    const html = render();
    const start = html.indexOf('aria-label="Debate destinations"');
    const list = html.slice(start, html.indexOf('</ul>', start));
    assert({
      given: 'the home dashboard',
      should: 'link each tile destination exactly once inside the named list',
      actual: [
        start > -1,
        tiles.map((tile) => occurrences(list, `href="${tile.href}"`)),
      ],
      expected: [true, tiles.map(() => 1)],
    });
  });

  test('stacks the destinations in one column on a phone', () => {
    assert({
      given: 'the home dashboard',
      should: 'make the destinations a single column below the phone width',
      actual:
        /<ul class="[^"]*max-narrow:grid-cols-1[^"]*"[^>]*aria-label="Debate destinations"/.test(
          render(),
        ),
      expected: true,
    });
  });

  test('shows a visitor on a phone nothing but the way in', () => {
    const destinations = (html: string) =>
      /<ul class="[^"]*max-narrow:hidden[^"]*"[^>]*aria-label="Debate destinations"/.test(
        html,
      );
    assert({
      given: 'a visitor and a member',
      should: 'hide the menu from the visitor alone',
      actual: [destinations(render()), destinations(renderWithGlance())],
      expected: [true, false],
    });
  });

  test('leaves the lower cards off a phone for everyone', () => {
    const lowerCards = (html: string) =>
      /<div class="[^"]*grid-cols-dash-lower[^"]*max-narrow:hidden/.test(html);
    assert({
      given: 'a visitor and a member',
      should: 'hide the tournament and Live now cards from both',
      actual: [lowerCards(render()), lowerCards(renderWithGlance())],
      expected: [true, true],
    });
  });

  test('reveals the season on the Seasons note alone', () => {
    const html = renderWithGlance();
    const noteOf = (href: string) =>
      html.slice(html.indexOf(`href="${href}"`)).split('</a>')[0] ?? '';
    assert({
      given: 'a running season',
      should: 'put its number and time on the Seasons note and no other',
      actual: [
        noteOf('/leaderboard/seasons').includes('12 days left'),
        occurrences(html, '12 days left'),
        occurrences(html, '>7</text>'),
      ],
      expected: [true, 1, 1],
    });
  });

  test('keeps the page outline valid inside the shell-owned <main>', () => {
    const html = render();
    assert({
      given: "the dashboard rendered inside AppShell's <main>",
      should:
        'carry exactly one h1, no h3 before it has an h2, and no own main',
      actual: [
        occurrences(html, '<h1'),
        occurrences(html, '<h3'),
        occurrences(html, '<main'),
      ],
      expected: [1, 0, 0],
    });
  });

  test('shows every destination as a note, with Live now and nothing closed', () => {
    const html = render();
    assert({
      given: 'the home dashboard',
      should:
        'carry no Coming soon tag, link the Beta Open to its page, and show Live now',
      actual: [
        occurrences(html, 'Coming soon'),
        html.includes('href="/tournaments"'),
        html.includes('Live now') || html.includes('Live Now'),
      ],
      expected: [0, true, true],
    });
  });

  test('ends with the way to About Daisy for visitors and members', () => {
    const strip = (html: string) =>
      /<section[^>]*class="[^"]*max-narrow:hidden[^"]*"[^>]*>[\s\S]*?href="\/about"[\s\S]*?<\/section>/.test(
        html,
      ) && html.lastIndexOf('href="/about"') > html.indexOf('Live now');
    assert({
      given: 'a visitor and a member',
      should:
        'close the dashboard with one About strip, off a phone like the cards above it, the visitor’s hero linking it too',
      actual: [
        strip(renderWithGlance()),
        strip(render()),
        occurrences(renderWithGlance(), 'href="/about"'),
        occurrences(render(), 'href="/about"'),
      ],
      expected: [true, true, 1, 2],
    });
  });
});

describe('Dashboard ladder words', () => {
  test('Play and Leaderboard keep their own words (YHomeActive)', () => {
    const html = renderInStore(
      h(Dashboard, {
        audience: 'member',
        hero: null,
        liveNow: null,
      }),
    );
    const play = (
      /<a[^>]*href="\/lobby"[^>]*>[\s\S]*?<\/a>/.exec(html)?.[0] ?? ''
    ).replace(/<[^>]*>/g, '');
    const playTile = tiles.find((tile) => tile.destination === 'lobby');
    assert({
      given: 'a youth member on Home',
      should:
        'show Play with only its title and tagline, and Leaderboard with its shipped tagline, naming no division',
      actual: [play, ladderCopyIn(html), html.includes('The season ladder.')],
      expected: [`${playTile?.title}${playTile?.description}`, null, true],
    });
  });
});
