import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { FeaturedTournament } from './featured-tournament';
import { tournament } from '../../mock/tournament';

setupRitewayBun();

describe('FeaturedTournament', () => {
  test('renders the event identity and entry point', () => {
    const html = renderToString(h(FeaturedTournament, {}));
    assert({
      given: 'the featured tournament card',
      should: 'carry the event name, a registration path, and the prize',
      actual: [
        html.includes(tournament.name),
        html.includes('href="/tournaments"'),
        html.includes('Register'),
        html.includes(tournament.prizePool),
      ],
      expected: [true, true, true, true],
    });
  });
});
