import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  screenFor,
  type SearchScreen,
} from '../../../features/ranked/drive-match';
import { testSources } from '../../../features/ranked/ranked.test-support';
import { MatchSearch } from './match-search';

setupRitewayBun();

const html = renderToString(
  h(MatchSearch, {
    screen: screenFor(
      { step: 'search', rules: false },
      testSources(),
    ) as SearchScreen,
  }),
);

describe('MatchSearch', () => {
  test('a heading, the rule line, a timer and a cancel link', () => {
    assert({
      given: 'the search step',
      should: 'say Finding a match, Ranked · standard rules, 0:00 and cancel',
      actual: [
        html.includes('>Finding a match</h1>'),
        html.includes('Ranked · standard rules'),
        html.includes('0:00'),
        html.includes('href="/ranked"'),
        html.includes('Cancel search'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('moves on to the offer with no script', () => {
    assert({
      given: 'the search step',
      should: 'refresh to the offer after the search time',
      actual: html.includes('content="5;url=/ranked?step=offer"'),
      expected: true,
    });
  });

  test('never lists players', () => {
    assert({
      given: 'the search step',
      should: 'render no list',
      actual: html.includes('<ul') || html.includes('<table'),
      expected: false,
    });
  });
});
