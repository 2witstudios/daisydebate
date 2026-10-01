import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Person } from './person';

setupRitewayBun();

describe('Person', () => {
  test('handle, chip and rating', () => {
    const you = renderToString(
      h(Person, { handle: 'debater-a', rating: 1620, you: true }),
    );
    const provisional = renderToString(
      h(Person, { handle: 'debater-m', rating: null }),
    );
    assert({
      given: 'the viewer with a rating, and a provisional entrant',
      should: 'show @handle, the You chip, the rating or Provisional',
      actual: [
        you.includes('@debater-a'),
        you.includes('You'),
        you.includes('1620'),
        provisional.includes('Provisional'),
        provisional.includes('>You<'),
        renderToString(h(Person, { handle: 'x' })).includes('tabular-nums'),
      ],
      expected: [true, true, true, true, false, false],
    });
  });
});
