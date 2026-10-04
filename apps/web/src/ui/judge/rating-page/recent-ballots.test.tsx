import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RecentBallot } from '../../../features/judge/rating';
import { RecentBallots } from './recent-ballots';

setupRitewayBun();

const ballot = (over: Partial<RecentBallot>): RecentBallot => ({
  id: 'b',
  debateLabel: 'Debate [N]',
  daysAgo: 3,
  decision: 'neg',
  helpful: 2,
  answered: 3,
  comment: 'Clear.',
  review: null,
  delta: 6,
  ...over,
});

const render = (ballots: readonly RecentBallot[]) =>
  renderToString(h(RecentBallots, { ballots }));

describe('RecentBallots', () => {
  test('a ballot with a comment', () => {
    const html = render([ballot({})]);
    assert({
      given: 'a neg ballot from 3 days ago with 2 of 3 helpful and a comment',
      should: 'show decision, age, feedback, the quoted comment and a gain',
      actual: [
        html.includes('Debate [N] · Neg wins'),
        html.includes('3 days ago'),
        html.includes('Debater feedback: 2 of 3 marked helpful'),
        html.includes('“Clear.”'),
        html.includes('+6'),
        html.includes('text-online'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('a reviewed loss without a comment', () => {
    const html = render([
      ballot({ comment: null, review: 'Review: ballot stands', delta: -3 }),
    ]);
    assert({
      given: 'a ballot with no comment, a review outcome and a loss',
      should:
        'show the review line, no quote and a signed loss in the loss tone',
      actual: [
        html.includes('Review: ballot stands'),
        html.includes('“'),
        html.includes('−3'),
        html.includes('text-live'),
      ],
      expected: [true, false, true, true],
    });
  });
});
