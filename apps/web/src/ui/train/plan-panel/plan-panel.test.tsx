import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { hubView } from '../../../features/train/hub';
import { sampleSummary } from '../../mock/train';
import { PlanPanel } from './plan-panel';

setupRitewayBun();

const render = (query: Parameters<typeof hubView>[1]) => {
  const view = hubView(sampleSummary, query);
  return renderToString(
    h(PlanPanel, {
      stage: view.stage,
      dueTomorrow: 2,
      plan: view.plan,
      totalMinutes: view.totalMinutes,
      query,
    }),
  );
};

describe('PlanPanel', () => {
  test('the time choices are links that keep the plan', () => {
    const html = render({ mins: 20, did: ['review'] });
    assert({
      given: 'a twenty minute plan with review done',
      should: 'link each time, mark twenty current and keep done items',
      actual: [
        html.includes('href="/train?mins=10&amp;did=review"'),
        html.includes('href="/train?did=review"'),
        html.includes('href="/train?mins=40&amp;did=review"'),
        /aria-current="true"[^>]*>20 min/.test(html),
        html.includes('About 20 minutes'),
      ],
      expected: [true, true, true, true, true],
    });
  });

  test('rows: a done row has no action, an open one carries the plan', () => {
    const html = render({ mins: 20, did: ['review'] });
    assert({
      given: 'review done and the impact drill open',
      should: 'mark review Done and link the drill with the plan context',
      actual: [
        html.includes('>Done<'),
        html.includes('6 of 6 reviewed'),
        html.includes('href="/train/drill?kind=impact&amp;did=review"'),
        html.includes('aria-label="Start: Impact drill"'),
        html.includes('href="/train/review?did=review"'),
      ],
      expected: [true, true, true, true, false],
    });
  });

  test('done: no picker, the next review and a practice link', () => {
    const html = render({ mins: 10, did: ['review', 'impact-drill'] });
    assert({
      given: 'a finished ten minute plan',
      should: 'say so, hide the picker and point at tomorrow',
      actual: [
        html.includes('You finished today&#x27;s plan. Nothing else is due.'),
        html.includes('aria-label="Time available"'),
        html.includes('Next review: tomorrow'),
        html.includes('2 arguments due'),
        html.includes('Practice a debate anyway'),
      ],
      expected: [true, false, true, true, true],
    });
  });
});
