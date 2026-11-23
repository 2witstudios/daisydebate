import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { HiddenWhileJudging } from './hidden-while-judging';

setupRitewayBun();

describe('HiddenWhileJudging', () => {
  test('says the rating is hidden', () => {
    assert({
      given: 'a debater the viewer is judging',
      should: 'say the details are hidden while judging',
      actual: renderAccessible(h(HiddenWhileJudging))
        .textContent()
        .includes('Hidden while you judge'),
      expected: true,
    });
  });
});
