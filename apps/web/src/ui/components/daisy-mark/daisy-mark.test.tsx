import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { DaisyLogo, DaisyMark } from './daisy-mark';

setupRitewayBun();

describe('DaisyMark', () => {
  test('draws eight petals around a disc, hidden from assistive tech', () => {
    const html = renderToString(h(DaisyMark, { size: 24 }));
    assert({
      given: 'a mark',
      should: 'render eight petals, one disc, and aria-hidden',
      actual: [
        html.match(/<ellipse/g)?.length,
        html.match(/<circle/g)?.length,
        html.includes('aria-hidden="true"'),
        html.includes('width="24"'),
      ],
      expected: [8, 1, true, true],
    });
  });

  test('lets the disc take its own fill', () => {
    const html = renderToString(
      h(DaisyMark, { size: 24, discClassName: 'fill-gold' }),
    );
    assert({
      given: 'a disc class',
      should: 'apply it to the disc',
      actual: html.includes('class="fill-gold"'),
      expected: true,
    });
  });
});

describe('DaisyLogo', () => {
  test('sits the mark on the accent tile', () => {
    const html = renderToString(h(DaisyLogo));
    assert({
      given: 'the logo',
      should: 'wrap the mark in the accent tile',
      actual: [html.includes('bg-accent'), html.includes('<ellipse')],
      expected: [true, true],
    });
  });
});
