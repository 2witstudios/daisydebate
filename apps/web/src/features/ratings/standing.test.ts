import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ratingStanding } from './standing';
setupRitewayBun();

test('all rating displays classify from widened precision before rounding', () => {
  const at = '2026-10-28T00:00:00.000Z';
  const state = { rating: 1500.1, deviation: 110.000001, volatility: 0.06 };
  assert({
    given: 'RD just above110 and the common injected display instant',
    should: 'round the figure while preserving provisional uncertainty',
    actual: ratingStanding(state, at, at),
    expected: { rating: 1500, deviation: 110.000001, provisional: true },
  });
});
