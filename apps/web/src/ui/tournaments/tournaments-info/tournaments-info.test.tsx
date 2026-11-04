import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { TournamentsInfo } from './tournaments-info';

setupRitewayBun();

describe('TournamentsInfo', () => {
  const html = renderToString(h(TournamentsInfo));

  test('reads the plans', () => {
    assert({
      given: 'the Tournaments page',
      should: 'name each planned event and tabulation under one h1',
      actual: [
        (html.match(/<h1/g) ?? []).length,
        ...[
          'Public Beta Open',
          'Weekly round robins',
          'Seasonal qualifiers',
          'Championships',
          'Tabulation software',
        ].map((title) => html.includes(title)),
      ],
      expected: [1, true, true, true, true, true],
    });
  });

  test('is information only', () => {
    assert({
      given: 'the Tournaments page',
      should: 'carry no Coming soon, button, link or form',
      actual: ['Coming soon', '<button', '<a ', '<form'].map((text) =>
        html.includes(text),
      ),
      expected: [false, false, false, false],
    });
  });
});
