import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { TrainPage } from './train-page';

setupRitewayBun();

describe('TrainPage', () => {
  test('the landing frame', () => {
    const html = renderToString(h(TrainPage, null, h('p', null, 'MAIN')));
    assert({
      given: 'the page content',
      should: 'render inside the shared frame',
      actual: html.includes('MAIN'),
      expected: true,
    });
  });
});
