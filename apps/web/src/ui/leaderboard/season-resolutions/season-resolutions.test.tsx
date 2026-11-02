import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { SeasonResolutions } from './season-resolutions';

setupRitewayBun();

const publication = {
  id: 'pryied8jvkvrn7g0p60iv632',
  kind: 'policy',
  text: 'Resolved: Cities should abolish minimum parking requirements.',
  provenance: 'Test publication',
  publishedAt: '2026-10-29T00:00:00.000Z',
  edition: 'Edition one',
  theme: 'Cities',
} as const;

const render = (resolutions: readonly (typeof publication | object)[]) =>
  renderToString(
    h(SeasonResolutions, {
      resolutions: resolutions as Parameters<
        typeof SeasonResolutions
      >[0]['resolutions'],
    }),
  ).replace(/<!-- -->/g, '');

describe('SeasonResolutions', () => {
  test('a published resolution', () => {
    const html = render([publication]);
    assert({
      given: 'a published resolution with an edition and theme',
      should: 'show its kind, edition, exact wording and theme',
      actual: [
        html.includes('Policy · Edition one'),
        html.includes(publication.text),
        html.includes('Cities</span>'),
        html.includes('Test publication'),
      ],
      expected: [true, true, true, false],
    });
  });

  test('a publication with no edition or theme', () => {
    const html = render([
      { ...publication, kind: 'value', edition: null, theme: null },
    ]);
    assert({
      given: 'a value resolution with no edition or theme',
      should: 'label it Value alone',
      actual: [html.includes('>Value<'), html.includes(' · ')],
      expected: [true, false],
    });
  });

  test('nothing published', () => {
    assert({
      given: 'no published resolutions',
      should: 'render nothing',
      actual: render([]),
      expected: '',
    });
  });
});
