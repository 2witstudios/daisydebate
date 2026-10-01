import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  screenFor,
  type ReadyScreen,
} from '../../../features/ranked/drive-match';
import { testSources } from '../../../features/ranked/ranked.test-support';
import { MatchReady } from './match-ready';

setupRitewayBun();

const html = renderToString(
  h(MatchReady, {
    screen: screenFor(
      { step: 'ready', rules: false },
      testSources(),
    ) as ReadyScreen,
  }),
);

describe('MatchReady', () => {
  test('both players ready, room opening', () => {
    assert({
      given: 'the ready step',
      should: 'say Both ready, Opening your room and mark both players',
      actual: [
        html.includes('>Both ready</h1>'),
        html.includes('Opening your room.'),
        html.includes('@rival'),
        html.match(/>Ready</g)?.length,
      ],
      expected: [true, true, true, 2],
    });
  });

  test('moves on to entering with no script', () => {
    assert({
      given: 'the ready step',
      should: 'refresh to entering',
      actual: html.includes('content="3;url=/ranked?step=entering"'),
      expected: true,
    });
  });
});
