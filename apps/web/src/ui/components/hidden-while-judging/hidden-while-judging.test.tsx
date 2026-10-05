import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { HiddenWhileJudging } from './hidden-while-judging';

setupRitewayBun();

describe('HiddenWhileJudging', () => {
  test('says the rating is hidden', () => {
    assert({
      given: 'a debater the viewer is judging',
      should: 'say the details are hidden while judging',
      actual: renderToString(h(HiddenWhileJudging)).includes(
        'Hidden while you judge',
      ),
      expected: true,
    });
  });
});
