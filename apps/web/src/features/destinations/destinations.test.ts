import { join } from 'node:path';
import { Glob } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  destinationHref,
  destinationPrefetch,
  destinations,
  destinationSlugs,
} from './destinations';

setupRitewayBun();

describe('destinations', () => {
  test('covers the eight destinations in landing order', () => {
    assert({
      given: 'the destination slugs',
      should: 'list the eight destinations in landing order',
      actual: destinationSlugs,
      expected: [
        'lobby',
        'watch',
        'judge',
        'tournaments',
        'seasons',
        'leaderboard',
        'train',
        'prep',
      ],
    });
  });

  test('keys every entry by its own slug', () => {
    assert({
      given: 'the copy table',
      should: 'key each entry by the slug it carries',
      actual: destinationSlugs.filter(
        (slug) => destinations[slug].slug !== slug,
      ),
      expected: [],
    });
  });

  test('has copy for every destination', () => {
    assert({
      given: 'every destination',
      should: 'carry a title and a tagline',
      actual: destinationSlugs.filter((slug) => {
        const copy = destinations[slug];
        return copy.title === '' || copy.tagline === '';
      }),
      expected: [],
    });
  });

  test('never names a format', () => {
    const copy = JSON.stringify(destinations);
    assert({
      given: 'all destination copy',
      should: 'not mention debate formats: there is one debate, Ranked',
      actual: /lincoln|douglas|public forum|parliamentary|format/i.test(copy),
      expected: false,
    });
  });
});

describe('destinationHref', () => {
  test('names each destination by its slug, with Seasons under the Leaderboard', () => {
    assert({
      given: 'Play, Tournaments and Seasons',
      should: 'link to the Lobby, the info page and the seasons page',
      actual: [
        destinationHref('lobby'),
        destinationHref('tournaments'),
        destinationHref('seasons'),
      ],
      expected: ['/lobby', '/tournaments', '/leaderboard/seasons'],
    });
  });
});

describe('destinationPrefetch', () => {
  test('turns prefetch off only for the destination with no page', () => {
    assert({
      given: 'Prep, another destination, and a page under neither',
      should: 'refuse Prep and leave the rest to the default',
      actual: ['/prep', '/lobby', '/settings'].map(destinationPrefetch),
      expected: [false, null, null],
    });
  });
});

describe('sample data', () => {
  test('no page reads it', async () => {
    const app = join(import.meta.dir, '../../app');
    const readers: string[] = [];
    let scanned = 0;
    for await (const file of new Glob('**/page.tsx').scan(app)) {
      scanned += 1;
      if ((await Bun.file(join(app, file)).text()).includes('/ui/mock/'))
        readers.push(file);
    }
    assert({
      given: 'every page in the app',
      should: 'pass no sample data to a feature',
      actual: { readers, scannedPages: scanned > 0 },
      expected: { readers: [], scannedPages: true },
    });
  });
});
