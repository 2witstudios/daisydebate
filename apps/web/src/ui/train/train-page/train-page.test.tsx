import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { TrainPage } from './train-page';

setupRitewayBun();

describe('TrainPage', () => {
  test('the landing frame', () => {
    const view = renderAccessible(h(TrainPage, null, h('p', null, 'MAIN')));
    assert({
      given: 'the page content',
      should: 'render inside the shared frame',
      actual: view.text('paragraph'),
      expected: 'MAIN',
    });
  });
});
