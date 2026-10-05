import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { TimeBar } from './time-bar';

setupRitewayBun();

describe('TimeBar', () => {
  test('over shows the warning, within shows the spare time', () => {
    const over = renderToString(
      h(TimeBar, {
        label: 'Whole brief',
        clock: '8:52',
        budget: { over: true, deltaSeconds: 52, percent: 100 },
        overText: '0:52 over',
        spareText: 'spare',
      }),
    );
    const within = renderToString(
      h(TimeBar, {
        label: 'Contention 1',
        clock: '2:45',
        budget: { over: false, deltaSeconds: 315, percent: 34 },
        overText: 'past it',
        spareText: '5:15 to spare',
      }),
    );
    assert({
      given: 'a bar over the limit and one within it',
      should: 'warn only on the first, with the reading time',
      actual: [
        over.includes('0:52 over'),
        over.includes('>8:52<'),
        over.includes('value="100"'),
        within.includes('5:15 to spare'),
        within.includes('past it'),
        within.includes('value="34"'),
      ],
      expected: [true, true, true, true, false, true],
    });
  });
});
