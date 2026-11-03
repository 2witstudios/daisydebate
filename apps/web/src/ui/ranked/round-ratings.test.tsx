import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { RoundRatings } from './round-ratings';

setupRitewayBun();

const view = {
  ladder: 'freestyle',
  season: 'Season 1',
  rows: [],
  rated: false,
  pending: false,
};

test('the receipt says whether the ladder rated the Round', () => {
  const says = (overrides: Partial<typeof view>) => {
    const html = renderToString(
      <RoundRatings view={{ ...view, ...overrides }} />,
    );
    return {
      rated: html.includes('<p>Rated</p>'),
      pending: html.includes('Rating update pending'),
    };
  };
  assert({
    given: 'a posted Round, one still owed a rating and an unrated one',
    should: 'say Rated, then pending, then neither',
    actual: [says({ rated: true }), says({ pending: true }), says({})],
    expected: [
      { rated: true, pending: false },
      { rated: false, pending: true },
      { rated: false, pending: false },
    ],
  });
});
