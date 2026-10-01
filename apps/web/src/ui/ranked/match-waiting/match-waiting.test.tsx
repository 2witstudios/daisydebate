import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  screenFor,
  type WaitingScreen,
} from '../../../features/ranked/drive-match';
import { testSources } from '../../../features/ranked/ranked.test-support';
import { MatchWaiting } from './match-waiting';

setupRitewayBun();

const html = renderToString(
  h(MatchWaiting, {
    screen: screenFor(
      { step: 'waiting', rules: false },
      testSources(),
    ) as WaitingScreen,
  }),
);

describe('MatchWaiting', () => {
  test('you accepted, they have not', () => {
    assert({
      given: 'the waiting step',
      should: 'name the opponent, show both rows and the countdown',
      actual: [
        html.includes('>Waiting for @rival</h1>'),
        html.includes('You accepted'),
        html.includes('Has not accepted yet'),
        html.includes('seconds'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('moves on to ready with no script', () => {
    assert({
      given: 'the waiting step',
      should: 'refresh to ready',
      actual: html.includes('content="3;url=/ranked?step=ready"'),
      expected: true,
    });
  });
});
