import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RankedRating } from '../../../features/ranked/standing';
import { RatingDisplay } from './rating-display';

setupRitewayBun();

const season = { number: 3, daysLeft: 41 };
const render = (rating: RankedRating): string =>
  renderToString(h(RatingDisplay, { standing: { rating, season } }));

describe('RatingDisplay', () => {
  test('provisional', () => {
    const html = render({ kind: 'provisional', value: 1412 });
    assert({
      given: 'a provisional rating',
      should: 'show the number, the status and the season',
      actual: [
        html.includes('>1412<'),
        html.includes('Provisional'),
        html.includes('Season 3 · 41 days left'),
      ],
      expected: [true, true, true],
    });
  });

  test('established', () => {
    const html = render({ kind: 'established', value: 1586 });
    assert({
      given: 'an established rating',
      should: 'show the number and Established',
      actual: [html.includes('>1586<'), html.includes('Established')],
      expected: [true, true],
    });
  });

  test('unrated', () => {
    const html = render({ kind: 'unrated' });
    assert({
      given: 'no rating yet',
      should:
        'say Unrated once, explain the first debate and still show the season',
      actual: [
        html.match(/Unrated/g)?.length,
        html.includes('Your first ranked debate sets your rating.'),
        html.includes('Season 3 · 41 days left'),
      ],
      expected: [1, true, true],
    });
  });
});
