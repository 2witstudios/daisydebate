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
      hero: null,
      liveNow: null,
      seasonGlance: { number: 7, line: '12 days left' },
    }),
  );

const render = (): string =>
  renderInStore(
    h(Dashboard, {
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
});
