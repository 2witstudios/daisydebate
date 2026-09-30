import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ProgressBar } from './progress-bar';

setupRitewayBun();

describe('ProgressBar', () => {
  test('a half-full bar', () => {
    const html = renderToString(
      h(ProgressBar, { percent: 50, tone: 'accent', label: 'Progress' }),
    );
    assert({
      given: 'a bar at 50 percent',
      should: 'expose its value and label and draw half the track',
      actual: [
        html.includes('role="progressbar"'),
        html.includes('aria-label="Progress"'),
        html.includes('aria-valuenow="50"'),
        html.includes('w-1/2'),
      ],
      expected: [true, true, true, true],
    });
  });
});
