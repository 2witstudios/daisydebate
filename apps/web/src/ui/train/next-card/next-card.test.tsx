import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { NextCard } from './next-card';

setupRitewayBun();

const base = {
  title: 'Impact drill',
  reason: 'Why.',
  minutes: 8,
  href: '/train/drill?kind=impact',
};
const query = { mins: 20, did: [] } as const;

describe('NextCard', () => {
  test('recommended', () => {
    const html = renderToString(
      h(NextCard, { next: { ...base, kind: 'recommended' }, query }),
    );
    assert({
      given: 'a recommended drill',
      should: 'mark it sample, offer the drill and another choice',
      actual: [
        html.includes('Recommended next'),
        html.includes('Sample'),
        html.includes('About 8 min'),
        html.includes('Start impact drill'),
        html.includes('Choose another'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('optional', () => {
    const html = renderToString(
      h(NextCard, { next: { ...base, kind: 'optional' }, query }),
    );
    assert({
      given: 'an optional drill after the plan',
      should: 'offer Start only',
      actual: [
        html.includes('Optional'),
        html.includes('>Start<'),
        html.includes('Choose another'),
        html.includes('Sample'),
      ],
      expected: [true, true, false, false],
    });
  });
});
