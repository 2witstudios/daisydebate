import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  screenFor,
  type EnteringScreen,
} from '../../../features/ranked/drive-match';
import { testSources } from '../../../features/ranked/ranked.test-support';
import { MatchEntering } from './match-entering';

setupRitewayBun();

const html = renderToString(
  h(MatchEntering, {
    screen: screenFor(
      { step: 'entering', rules: false },
      testSources(),
    ) as EnteringScreen,
  }),
);

describe('MatchEntering', () => {
  test('the room, the rule line and Enter room', () => {
    assert({
      given: 'the entering step',
      should: 'state the rules and sides and link Enter room to the play shell',
      actual: [
        html.includes('>Your room is ready</h1>'),
        html.includes('Ranked · standard rules · sides are Aff and Neg'),
        html.includes('@rival'),
        /href="\/play"[^>]*>Enter room/.test(html),
      ],
      expected: [true, true, true, true],
    });
  });

  test('enters the room by itself with no script', () => {
    assert({
      given: 'the entering step',
      should: 'refresh to /play',
      actual: html.includes('content="4;url=/play"'),
      expected: true,
    });
  });
});
