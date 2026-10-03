import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  parseReviewQuery,
  reviewView,
  type ReviewCard,
} from '../../../features/train/review';
import { sampleReviewCards } from '../../mock/train-review';
import { ReviewPage } from './review-page';

setupRitewayBun();

const cards: readonly ReviewCard[] = sampleReviewCards.slice(0, 3);
const library = { total: 12, dueTomorrow: 4 };
const render = (params: Record<string, string>, total = library.total) =>
  renderToString(
    h(ReviewPage, {
      view: reviewView(cards, parseReviewQuery(params), { ...library, total }),
    }),
  );

describe('ReviewPage', () => {
  test('a card, before the answer', () => {
    const html = render({});
    assert({
      given: 'the first card, not revealed',
      should:
        'show the claim as the cue, offer the answer and the queue, and hide the warrant',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes(cards[0]!.claim),
        html.includes('Show the answer'),
        html.includes(cards[0]!.warrant),
        html.includes('Card 1 of 3'),
        html.includes('aria-current="step"'),
      ],
      expected: [1, true, true, false, true, true],
    });
  });

  test('a card, revealed', () => {
    const html = render({ card: '2', reveal: '1', last: 'good' });
    assert({
      given: 'the second card with its answer shown after a Good',
      should: 'show warrant and impact, the four ratings and the last rating',
      actual: [
        html.includes(cards[1]!.warrant),
        html.includes(cards[1]!.impact),
        ['Again', 'Hard', 'Good', 'Easy'].every((label) =>
          html.includes(`>${label}</span>`),
        ),
        html.includes('Good: back in 4 days'),
        html.includes('Show the answer'),
      ],
      expected: [true, true, true, true, false],
    });
  });

  test('caught up', () => {
    const html = render({ card: '4' });
    assert({
      given: 'a position past the last card',
      should: 'say you are caught up, when the next review is, and link back',
      actual: [
        html.includes('You are caught up'),
        html.includes('Next review: tomorrow, 4 arguments.'),
        html.includes('Back to Train'),
      ],
      expected: [true, true, true],
    });
  });

  test('an empty library', () => {
    const html = render({}, 0);
    assert({
      given: 'no saved arguments at all',
      should: 'say there is nothing to review and offer a drill',
      actual: [
        html.includes('Nothing to review yet'),
        html.includes('Write an argument'),
        html.includes('Show the answer'),
      ],
      expected: [true, true, false],
    });
  });
});
