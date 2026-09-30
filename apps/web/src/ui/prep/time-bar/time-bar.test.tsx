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
        overText: 'Over [speech time] by [0:52].',
        spareText: 'spare',
      }),
    );
    const within = renderToString(
      h(TimeBar, {
        label: 'Contention 1',
        clock: '2:45',
        budget: { over: false, deltaSeconds: 315, percent: 34 },
        overText: 'over',
        spareText: '[5:15] to spare',
      }),
    );
    assert({
      given: 'a bar over the limit and one within it',
      should: 'warn only on the first, and show the limit as a placeholder',
      actual: [
        over.includes('Over [speech time] by [0:52].'),
        over.includes('8:52 of [speech time]'),
        over.includes('value="100"'),
        within.includes('[5:15] to spare'),
        within.includes('Over'),
        within.includes('value="34"'),
      ],
      expected: [true, true, true, true, false, true],
    });
  });
});
