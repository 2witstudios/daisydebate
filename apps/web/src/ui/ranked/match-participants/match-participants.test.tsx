import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { MatchParticipants } from './match-participants';

setupRitewayBun();

describe('MatchParticipants', () => {
  test('a check for done, a dashed ring for pending', () => {
    const html = renderToString(
      h(MatchParticipants, {
        participants: [
          { name: 'You', note: 'Accepted', done: true },
          { name: '@rival', note: 'Has not accepted yet', done: false },
        ],
      }),
    );
    assert({
      given: 'one accepted and one pending player',
      should: 'list both, with one check and one dashed ring',
      actual: [
        html.match(/<li/g)?.length,
        html.includes('Accepted'),
        html.includes('Has not accepted yet'),
        html.match(/<svg/g)?.length,
        html.match(/border-dashed/g)?.length,
      ],
      expected: [2, true, true, 1, 1],
    });
  });
});
