import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { StartJudging } from './start-judging';

setupRitewayBun();

describe('StartJudging', () => {
  test('the one action', () => {
    const html = renderToString(h(StartJudging));
    assert({
      given: 'the start panel',
      should:
        'offer one Start judging link to the waiting screen and never list debates',
      actual: [
        /<a [^>]*href="\/judge\/waiting"[^>]*>Start judging<\/a>/.test(html),
        html.split('<a ').length - 1,
        html.includes('You never choose the debate'),
        html.includes('<li'),
      ],
      expected: [true, 1, true, false],
    });
  });
});
