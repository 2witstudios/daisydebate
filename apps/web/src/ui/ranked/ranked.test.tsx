import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { screenFor } from '../../features/ranked/drive-match';
import { matchSteps } from '../../features/ranked/ranked-query';
import { testSources } from '../../features/ranked/ranked.test-support';
import { Ranked } from './ranked';

setupRitewayBun();

describe('Ranked', () => {
  test('every step renders its own single heading', () => {
    const headings = (['hub', ...matchSteps] as const).map((step) => {
      const html = renderToString(
        h(Ranked, { screen: screenFor({ step, rules: false }, testSources()) }),
      );
      return [html.match(/<h1/g)?.length, /<h1[^>]*>([^<]*)</.exec(html)?.[1]];
    });
    assert({
      given: 'each of the seven steps',
      should: 'render one h1 that names the step',
      actual: headings,
      expected: [
        [1, 'Ranked'],
        [1, 'Finding a match'],
        [1, 'Ready to debate?'],
        [1, 'Waiting for @rival'],
        [1, 'Both ready'],
        [1, 'Your room is ready'],
        [1, 'The match did not go ahead'],
      ],
    });
  });
});
