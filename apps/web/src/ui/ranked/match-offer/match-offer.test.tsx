import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  screenFor,
  type OfferScreen,
} from '../../../features/ranked/drive-match';
import { testSources } from '../../../features/ranked/ranked.test-support';
import { MatchOffer } from './match-offer';

setupRitewayBun();

const html = renderToString(
  h(MatchOffer, {
    screen: screenFor(
      { step: 'offer', rules: false },
      testSources(),
    ) as OfferScreen,
  }),
);

describe('MatchOffer', () => {
  test('the opponent, the countdown and both answers', () => {
    assert({
      given: 'the offer step',
      should: 'show the opponent and link Accept and Decline',
      actual: [
        html.includes('Match found'),
        html.includes('Ready to debate?'),
        html.includes('@rival'),
        html.includes('>1438<'),
        html.includes('seconds'),
        html.includes('href="/ranked?step=waiting"'),
        html.includes('href="/ranked?step=ended"'),
      ],
      expected: [true, true, true, true, true, true, true],
    });
  });

  test('times out to the ended state with no script', () => {
    assert({
      given: 'the offer step',
      should: 'refresh to ended after the respond time',
      actual: html.includes('content="20;url=/ranked?step=ended"'),
      expected: true,
    });
  });
});
