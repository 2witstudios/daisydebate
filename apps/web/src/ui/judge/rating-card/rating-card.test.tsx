import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getJudgeRating } from '../../../features/judge/get-judge-rating';
import { RatingCard } from './rating-card';

setupRitewayBun();

describe('RatingCard', () => {
  test('a provisional judge', () => {
    const html = renderToString(h(RatingCard, { rating: getJudgeRating() }));
    assert({
      given: 'the sample provisional judge',
      should:
        'show the rating, the provisional badge, progress and the link to the rating page',
      actual: [
        html.includes('1,388'),
        html.includes('Provisional'),
        html.includes('7 of 15 ballots with feedback to become established'),
        html.includes('aria-valuenow="47"'),
        html.includes('Private to you'),
        /<a [^>]*href="\/judge\/rating"[^>]*>Rating and recent ballots/.test(
          html,
        ),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('an established judge', () => {
    const html = renderToString(
      h(RatingCard, {
        rating: { ...getJudgeRating(), status: 'established', rating: 1512 },
      }),
    );
    assert({
      given: 'an established judge',
      should: 'say Established and fill the bar',
      actual: [
        html.includes('Established'),
        html.includes('Provisional'),
        html.includes('aria-valuenow="100"'),
      ],
      expected: [true, false, true],
    });
  });
});
