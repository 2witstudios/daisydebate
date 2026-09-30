import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getJudgeRating } from '../../../features/judge/get-judge-rating';
import { RatingPage } from './rating-page';

setupRitewayBun();

describe('RatingPage', () => {
  test('a provisional judge', () => {
    const html = renderToString(h(RatingPage, { rating: getJudgeRating() }));
    assert({
      given: 'the sample provisional judge',
      should:
        'have one h1, the rating, progress, the three inputs, the ballots and the design note',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('1,388'),
        html.includes('Provisional'),
        html.includes('7 of 15 ballots with feedback to become established.'),
        html.includes('Debater feedback on your reasons'),
        html.includes('Review outcomes'),
        html.includes('Agreement with the panel'),
        html.includes('Your recent ballots'),
        html.includes('Design assumption'),
        /<a [^>]*href="\/judge"/.test(html),
      ],
      expected: [1, true, true, true, true, true, true, true, true, true],
    });
  });

  test('an established judge', () => {
    const html = renderToString(
      h(RatingPage, {
        rating: {
          ...getJudgeRating(),
          status: 'established',
          rating: 1512,
        },
      }),
    );
    assert({
      given: 'an established judge',
      should: 'say Established and that the rating now moves more slowly',
      actual: [
        html.includes('1,512'),
        html.includes('Established. Your rating now changes more slowly.'),
        html.includes('Provisional'),
      ],
      expected: [true, true, false],
    });
  });
});
