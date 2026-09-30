import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sampleSummary } from '../../mock/train';
import { WeekCard } from './week-card';
import { WeekStrip } from './week-strip';

setupRitewayBun();

describe('WeekCard', () => {
  test('goal met', () => {
    const html = renderToString(h(WeekCard, { summary: sampleSummary }));
    assert({
      given: 'three sessions against a goal of three',
      should: 'say the goal is met and that rest days cost nothing',
      actual: [
        html.includes('3 of 3 sessions'),
        html.includes(': goal met.'),
        html.includes('Missing a day resets nothing'),
        html.includes('Practiced 12 of the last 30 days'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('goal not met', () => {
    const html = renderToString(
      h(WeekCard, {
        summary: {
          ...sampleSummary,
          week: { ...sampleSummary.week, goal: 5 },
        },
      }),
    );
    assert({
      given: 'three sessions against a goal of five',
      should: 'not claim the goal',
      actual: html.includes('goal met'),
      expected: false,
    });
  });
});

describe('WeekStrip', () => {
  test('names each day for readers', () => {
    const html = renderToString(
      h(WeekStrip, {
        trained: [true, false, false, false, false, false, false],
      }),
    );
    assert({
      given: 'Monday trained',
      should: 'say trained for Monday and rest day for the others',
      actual: [
        html.includes('Monday: trained'),
        html.match(/rest day/g)?.length,
      ],
      expected: [true, 6],
    });
  });
});
