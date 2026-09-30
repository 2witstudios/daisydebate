import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Meter } from './meter';

setupRitewayBun();

const filledCount = (html: string) => html.match(/bg-accent"/g)?.length ?? 0;

describe('Meter', () => {
  test('exposes its value and fills in proportion', () => {
    const html = renderToString(h(Meter, { value: 50, label: 'Claim' }));
    assert({
      given: 'half full',
      should: 'name the value and fill ten of twenty segments',
      actual: [
        html.includes('aria-label="Claim"'),
        html.includes('aria-valuenow="50"'),
        filledCount(html),
      ],
      expected: [true, true, 10],
    });
  });

  test('clamps', () => {
    assert({
      given: 'values below 0 and above 100',
      should: 'stay inside the track',
      actual: [
        renderToString(h(Meter, { value: -5, label: 'a' })).includes(
          'aria-valuenow="0"',
        ),
        renderToString(h(Meter, { value: 140, label: 'a' })).includes(
          'aria-valuenow="100"',
        ),
      ],
      expected: [true, true],
    });
  });
});
