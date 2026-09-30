import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { TrainCard } from './train-card';

setupRitewayBun();

describe('TrainCard', () => {
  test('heading level and sample badge', () => {
    const plain = renderToString(h(TrainCard, { title: 'A', children: 'x' }));
    const sample = renderToString(
      h(TrainCard, { title: 'B', level: 3, sample: true, children: 'x' }),
    );
    assert({
      given: 'a plain card and a sample card one level down',
      should: 'use the level and show Sample only on the sample card',
      actual: [
        plain.includes('<h2'),
        plain.includes('Sample'),
        sample.includes('<h3'),
        sample.includes('Sample'),
      ],
      expected: [true, false, true, true],
    });
  });
});
