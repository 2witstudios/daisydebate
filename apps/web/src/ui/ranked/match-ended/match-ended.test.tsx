import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  screenFor,
  type EndedScreen,
} from '../../../features/ranked/drive-match';
import { testSources } from '../../../features/ranked/ranked.test-support';
import { MatchEnded } from './match-ended';

setupRitewayBun();

const html = renderToString(
  h(MatchEnded, {
    screen: screenFor(
      { step: 'ended', rules: false },
      testSources(),
    ) as EndedScreen,
  }),
);

describe('MatchEnded', () => {
  test('one neutral message and two ways on', () => {
    assert({
      given: 'the ended step',
      should: 'say nothing changed and link a new search and the hub',
      actual: [
        html.includes('The match did not go ahead'),
        html.includes(
          'It was declined or timed out. Nothing changed on your rating.',
        ),
        html.includes('href="/ranked?step=search"'),
        html.includes('href="/ranked"'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('never says who declined and never advances', () => {
    assert({
      given: 'the ended step',
      should: 'name no opponent and not refresh',
      actual: [html.includes('@'), html.includes('refresh')],
      expected: [false, false],
    });
  });
});
