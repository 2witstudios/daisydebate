import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { RoundRatings } from './round-ratings';

setupRitewayBun();

test('the receipt says whether the ladder rated the Round', () => {
  const says = (posting: 'rated' | 'pending' | 'none') => {
    const html = renderToString(
      <RoundRatings
        view={{ ladder: 'freestyle', season: 'Season 1', rows: [], posting }}
      />,
    );
    return {
      rated: html.includes('<p>Rated</p>'),
      pending: html.includes('Rating update pending'),
    };
  };
  assert({
    given: 'a posted Round, one still owed a rating and an unrated one',
    should: 'say Rated, then pending, then neither',
    actual: [says('rated'), says('pending'), says('none')],
    expected: [
      { rated: true, pending: false },
      { rated: false, pending: true },
      { rated: false, pending: false },
    ],
  });
});
