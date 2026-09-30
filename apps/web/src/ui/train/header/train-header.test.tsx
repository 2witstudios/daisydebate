import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { TrainHeader } from './train-header';

setupRitewayBun();

describe('TrainHeader', () => {
  test('title, lede and the unrated promise', () => {
    const html = renderToString(h(TrainHeader, { title: 'Train', lede: 'Hi' }));
    assert({
      given: 'a title and lede',
      should: 'render one h1, the lede and the default unrated pill',
      actual: [
        html.match(/<h1/g)?.length,
        html.includes('Hi'),
        html.includes('Training never changes your rating'),
      ],
      expected: [1, true, true],
    });
  });
});
