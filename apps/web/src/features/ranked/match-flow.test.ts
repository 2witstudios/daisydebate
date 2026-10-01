import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { advanceFrom } from './match-flow';

setupRitewayBun();

const timings = {
  searchSeconds: 5,
  respondSeconds: 20,
  waitingSeconds: 3,
  readySeconds: 3,
  enterSeconds: 4,
};

describe('advanceFrom', () => {
  test('the happy path walks to the room', () => {
    assert({
      given: 'each step of a match that both players accept',
      should: 'move search, offer, waiting, ready, entering on in order',
      actual: (
        ['search', 'offer', 'waiting', 'ready', 'entering'] as const
      ).map((step) => advanceFrom(step, timings, '/play')),
      expected: [
        { afterSeconds: 5, href: '/ranked?step=offer' },
        { afterSeconds: 20, href: '/ranked?step=ended' },
        { afterSeconds: 3, href: '/ranked?step=ready' },
        { afterSeconds: 3, href: '/ranked?step=entering' },
        { afterSeconds: 4, href: '/play' },
      ],
    });
  });

  test('a match that fell through stays put', () => {
    assert({
      given: 'the ended step',
      should: 'never move on by itself',
      actual: advanceFrom('ended', timings, '/play'),
      expected: null,
    });
  });
});
