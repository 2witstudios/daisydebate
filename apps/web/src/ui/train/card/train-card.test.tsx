import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { TrainCard } from './train-card';

setupRitewayBun();

describe('TrainCard', () => {
  test('heading level', () => {
    const plain = renderToString(h(TrainCard, { title: 'A', children: 'x' }));
    const nested = renderToString(
      h(TrainCard, { title: 'B', level: 3, children: 'x' }),
    );
    assert({
      given: 'a plain card and a card one level down',
      should: 'use the level',
      actual: [plain.includes('<h2'), nested.includes('<h3')],
      expected: [true, true],
    });
  });
});
