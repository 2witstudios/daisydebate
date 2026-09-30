import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  destinations,
  destinationSlugs,
  findDestination,
} from './destinations';

setupRitewayBun();

describe('destinations', () => {
  test('covers the eight destinations in landing order', () => {
    assert({
      given: 'the destination slugs',
      should: 'list the eight destinations in landing order',
      actual: destinationSlugs,
      expected: [
        'ranked',
        'lobby',
        'watch',
        'judge',
        'tournaments',
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

  test('has complete copy for every destination', () => {
    assert({
      given: 'every destination',
      should: 'carry a tagline, a description, four steps and abilities',
      actual: destinationSlugs.filter((slug) => {
        const copy = destinations[slug];
        return (
          copy.title === '' ||
          copy.tagline === '' ||
          copy.what === '' ||
          copy.steps.length !== 4 ||
          copy.steps.some((step) => step.title === '' || step.body === '') ||
          copy.abilities.length < 3
        );
      }),
      expected: [],
    });
  });

  test('never names a format', () => {
    const copy = JSON.stringify(destinations);
    assert({
      given: 'all explainer copy',
      should: 'not mention debate formats: there is one debate, Ranked',
      actual: /lincoln|douglas|public forum|parliamentary|format/i.test(copy),
      expected: false,
    });
  });
});

describe('findDestination', () => {
  test('resolves a known slug', () => {
    assert({
      given: 'the slug "judge"',
      should: 'return the judge copy',
      actual: findDestination('judge')?.title,
      expected: 'Judge',
    });
  });

  test('refuses anything else', () => {
    assert({
      given: 'unknown, inherited and oddly cased segments',
      should: 'return null',
      actual: ['unknown', 'Ranked', '', 'constructor', '__proto__'].map(
        findDestination,
      ),
      expected: [null, null, null, null, null],
    });
  });
});
