import { join } from 'node:path';
import { Glob } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { destinationSlugs } from './destinations';
import {
  closedDestinationOf,
  destinationHref,
  explainerHref,
  launched,
  liveHref,
} from './launch';

setupRitewayBun();

const allSoon = Object.fromEntries(
  destinationSlugs.map((slug) => [slug, false]),
) as Record<(typeof destinationSlugs)[number], boolean>;

describe('closedDestinationOf', () => {
  test('every route of a closed destination is closed', () => {
    assert({
      given: 'no destination launched',
      should: 'name the destination that owns each area, at any depth',
      actual: [
        '/lobby',
        '/watch/abc',
        '/recordings',
        '/judge/waiting',
        '/tournaments/organize/new',
        '/leaderboard/seasons',
        '/train',
        '//prep/cards/abc',
        '/%70rep',
        '/%74ournaments/abc',
      ].map((path) => closedDestinationOf(path, allSoon)),
      expected: [
        'lobby',
        'watch',
        'watch',
        'judge',
        'tournaments',
        'leaderboard',
        'train',
        'prep',
        'prep',
        'tournaments',
      ],
    });
  });

  test('anything else stays open', () => {
    const allOpen = { ...allSoon, watch: true, prep: true };
    assert({
      given: 'paths no destination owns, lookalikes, and launched destinations',
      should: 'close none of them',
      actual: [
        closedDestinationOf('/', allSoon),
        closedDestinationOf('/settings', allSoon),
        closedDestinationOf('/coming-soon/prep', allSoon),
        closedDestinationOf('/prepare', allSoon),
        closedDestinationOf('/%zz', allSoon),
        closedDestinationOf('/constructor', allSoon),
        closedDestinationOf('/recordings', allOpen),
        closedDestinationOf('/prep', allOpen),
      ],
      expected: [null, null, null, null, null, null, null, null],
    });
  });

  test('every page that reads sample data sits in a closed area', async () => {
    const app = join(import.meta.dir, '../../app');
    const open: string[] = [];
    let scanned = 0;
    for await (const file of new Glob('**/page.tsx').scan(app)) {
      scanned += 1;
      if (!(await Bun.file(join(app, file)).text()).includes('/ui/mock/'))
        continue;
      const route = file.replace(/\(.*?\)\//g, '').replace(/\/?page\.tsx$/, '');
      if (closedDestinationOf(`/${route}`) === null) open.push(route);
    }
    assert({
      given: 'the pages that pass sample data to a feature',
      should: 'all answer with an explainer under the launch config',
      actual: { open, scannedPages: scanned > 0 },
      expected: { open: [], scannedPages: true },
    });
  });

  test('the unbuilt areas are out of reach today', () => {
    assert({
      given: 'the launch config',
      should: 'close the areas with no real screens',
      actual: ['/tournaments', '/prep', '/watch', '/recordings'].map((path) =>
        closedDestinationOf(path),
      ),
      expected: ['tournaments', 'prep', null, null],
    });
  });
});

describe('launch config', () => {
  test('names every destination', () => {
    assert({
      given: 'the launch config',
      should: 'have an entry per destination',
      actual: Object.keys(launched).sort(),
      expected: [...destinationSlugs].sort(),
    });
  });

  test('opens only the destinations with real screens', () => {
    assert({
      given: 'the launch config for the three-ladder beta',
      should:
        'open Play, Watch, Judge, Seasons, the real leaderboard and Train',
      actual: destinationSlugs.filter((slug) => launched[slug]),
      expected: ['lobby', 'watch', 'judge', 'seasons', 'leaderboard', 'train'],
    });
  });
});

describe('destinationHref', () => {
  test('points an unlaunched destination at its explainer', () => {
    assert({
      given: 'a destination that is not launched',
      should: 'link to the explainer',
      actual: destinationHref('watch', { config: allSoon }),
      expected: explainerHref('watch'),
    });
  });

  test('flipping one destination changes only that one', () => {
    assert({
      given: 'lobby flipped to launched',
      should: 'link lobby to its live route and leave the rest',
      actual: [
        destinationHref('lobby', { config: { ...allSoon, lobby: true } }),
        destinationHref('watch', { config: { ...allSoon, lobby: true } }),
      ],
      expected: [liveHref('lobby'), '/coming-soon/watch'],
    });
  });

  test('a deep link follows its destination', () => {
    assert({
      given: 'a page inside tournaments, launched and not',
      should: 'reach the page once launched and the explainer until then',
      actual: [
        destinationHref('tournaments', {
          path: '/tournaments/mine',
          config: allSoon,
        }),
        destinationHref('tournaments', {
          path: '/tournaments/mine',
          config: { ...allSoon, tournaments: true },
        }),
      ],
      expected: ['/coming-soon/tournaments', '/tournaments/mine'],
    });
  });

  test('Seasons lives under the leaderboard', () => {
    assert({
      given: 'the seasons destination, launched',
      should: 'link to the seasons page under the leaderboard',
      actual: destinationHref('seasons', {
        config: { ...allSoon, seasons: true },
      }),
      expected: '/leaderboard/seasons',
    });
  });
});
