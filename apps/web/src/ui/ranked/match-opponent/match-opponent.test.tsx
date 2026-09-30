import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { MatchOpponentCard } from './match-opponent';

setupRitewayBun();

describe('MatchOpponentCard', () => {
  test('handle, status and rating', () => {
    const html = renderToString(
      h(MatchOpponentCard, {
        opponent: { handle: 'rival', rating: 1438, status: 'established' },
      }),
    );
    assert({
      given: 'an established opponent',
      should: 'show the @handle, Established and the rating',
      actual: [
        html.includes('@rival'),
        html.includes('Established'),
        html.includes('>1438<'),
      ],
      expected: [true, true, true],
    });
  });

  test('a provisional opponent', () => {
    const html = renderToString(
      h(MatchOpponentCard, {
        opponent: { handle: 'rival', rating: 1200, status: 'provisional' },
      }),
    );
    assert({
      given: 'a provisional opponent',
      should: 'say Provisional',
      actual: html.includes('Provisional'),
      expected: true,
    });
  });
});
