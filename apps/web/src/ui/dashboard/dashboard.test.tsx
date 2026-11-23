import { ladderCopyIn } from '../test-support/ladder-copy.test-support';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Dashboard } from './dashboard';
import { HeroBanner } from './hero-banner/hero-banner';
import { LiveNow } from './live-now/live-now';
import { tiles } from './tiles';
import { initialLinkForm } from '../auth/request-link';
import { renderInStore } from '../test-support/render-in-store';
import type { AccessibleView } from '../../test-support/rendered/accessible';

setupRitewayBun();

const renderWithGlance = () =>
  renderInStore(
    h(Dashboard, {
      audience: 'member',
      hero: null,
      liveNow: null,
      seasonGlance: { number: 7, line: '12 days left' },
    }),
  );

const render = () =>
  renderInStore(
    h(Dashboard, {
      audience: 'visitor',
      hero: h(HeroBanner, {
        requestLink: () => Promise.resolve(initialLinkForm),
      }),
      liveNow: h(LiveNow, { rounds: [] }),
    }),
  );

/** The links a view offers to `href`. */
const linksTo = (view: AccessibleView, href: string) =>
  view.all('link').filter((link) => link.getAttribute('href') === href);

/** Whether `first` comes before `second` in the document. */
const precedes = (first: Element, second: Element) =>
  // 4 is Node.DOCUMENT_POSITION_FOLLOWING: `second` follows `first`.
  (first.compareDocumentPosition(second) & 4) !== 0;

const occurrences = (text: string, needle: string) =>
  text.split(needle).length - 1;

describe('Dashboard', () => {
  test('links every configured destination from a named list', () => {
    const view = render();
    const list = view.has('list', 'Debate destinations')
      ? view.within('list', 'Debate destinations')
      : null;
    assert({
      given: 'the home dashboard',
      should: 'link each tile destination exactly once inside the named list',
      actual: [
        list !== null,
        tiles.map((tile) => (list ? linksTo(list, tile.href).length : 0)),
      ],
      expected: [true, tiles.map(() => 1)],
    });
  });

  test('reveals the season on the Seasons note alone', () => {
    const view = renderWithGlance();
    const notes = view.within('list', 'Debate destinations').all('link');
    const showing = (needle: string) =>
      notes
        .filter((note) => (note.textContent ?? '').includes(needle))
        .map((note) => note.getAttribute('href'));
    assert({
      given: 'a running season',
      should: 'put its number and time on the Seasons note and no other',
      actual: [
        showing('12 days left'),
        occurrences(view.textContent(), '12 days left'),
        showing('7'),
      ],
      expected: [['/leaderboard/seasons'], 1, ['/leaderboard/seasons']],
    });
  });

  test('keeps the page outline valid inside the shell-owned <main>', () => {
    const view = render();
    assert({
      given: "the dashboard rendered inside AppShell's <main>",
      should:
        'carry exactly one h1, no h3 before it has an h2, and no own main',
      actual: [
        view.count('heading', undefined, { level: 1 }),
        view.count('heading', undefined, { level: 3 }),
        view.count('main'),
      ],
      expected: [1, 0, 0],
    });
  });

  test('shows every destination as a note, with Live now and nothing closed', () => {
    const view = render();
    assert({
      given: 'the home dashboard',
      should:
        'carry no Coming soon tag, link the Beta Open to its page, and show Live now',
      actual: [
        occurrences(view.textContent(), 'Coming soon'),
        view.attribute('link', 'Learn more', 'href'),
        view.has('region', 'Live now'),
      ],
      expected: [0, '/tournaments', true],
    });
  });

  test('ends with the way to About Daisy for visitors and members', () => {
    const strip = (view: AccessibleView) => {
      const about = view.get(
        'region',
        'Every debater, every league, one venue',
      );
      const live = view.has('region', 'Live now')
        ? view.get('region', 'Live now')
        : null;
      return [
        linksTo(
          view.within('region', 'Every debater, every league, one venue'),
          '/about',
        ).length,
        live === null || precedes(live, about),
        linksTo(view, '/about').length,
      ];
    };
    assert({
      given: 'a visitor and a member',
      should:
        'close the dashboard with one About strip after the cards above it, the visitor’s hero linking it too',
      actual: [strip(renderWithGlance()), strip(render())],
      expected: [
        [1, true, 1],
        [1, true, 2],
      ],
    });
  });
});

describe('Dashboard ladder words', () => {
  test('Play and Leaderboard keep their own words (YHomeActive)', () => {
    const view = renderInStore(
      h(Dashboard, {
        audience: 'member',
        hero: null,
        liveNow: null,
      }),
    );
    const [play] = linksTo(view, '/lobby');
    const playTile = tiles.find((tile) => tile.destination === 'lobby');
    const text = view.textContent();
    assert({
      given: 'a youth member on Home',
      should:
        'show Play with only its title and tagline, and Leaderboard with its shipped tagline, naming no division',
      actual: [
        play?.textContent,
        ladderCopyIn(text) ?? (text.includes('Freestyle') ? 'Freestyle' : null),
        text.includes('The season ladder.'),
      ],
      expected: [`${playTile?.title}${playTile?.description}`, null, true],
    });
  });
});
