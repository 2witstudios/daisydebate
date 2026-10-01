import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Countdown } from './countdown';
import { ElapsedClock } from './elapsed-clock';

setupRitewayBun();

describe('ElapsedClock', () => {
  test('reads 0:00 before hydration', () => {
    const html = renderToString(h(ElapsedClock));
    assert({
      given: 'the server render',
      should: 'show 0:00 with a spoken prefix',
      actual: [html.includes('0:00'), html.includes('Searching for')],
      expected: [true, true],
    });
  });
});

describe('Countdown', () => {
  test('starts full before hydration', () => {
    const html = renderToString(h(Countdown, { seconds: 20 }));
    assert({
      given: 'a 20 second countdown on the server',
      should: 'say 20 seconds and draw a full bar',
      actual: [
        /Respond within <span[^>]*>20<\/span> seconds/.test(html),
        html.includes('w-full'),
      ],
      expected: [true, true],
    });
  });
});
