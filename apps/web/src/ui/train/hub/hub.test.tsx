import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { hubView } from '../../../features/train/hub';
import type { HubQuery } from '../../../features/train/query';
import { sampleSummary } from '../../mock/train';
import { TrainHub } from './hub';

setupRitewayBun();

const render = (query: HubQuery) =>
  renderToString(
    h(TrainHub, {
      view: hubView(sampleSummary, query),
      summary: sampleSummary,
      query,
    }),
  );

describe('TrainHub', () => {
  test('working the plan', () => {
    const html = render({ mins: 20, did: [] });
    assert({
      given: 'a plan in progress',
      should: 'show the plan, the recommendation, the modes and the week',
      actual: [
        html.match(/<h1/g)?.length,
        html.includes('Today&#x27;s plan'),
        html.includes('Recommended next'),
        html.includes('Guided practice'),
        html.includes('Structure on the first check'),
        html.includes('Strongest and weakest parts'),
        html.includes('This week'),
        html.includes('Practice with custom rules'),
      ],
      expected: [1, true, true, true, true, true, true, true],
    });
  });

  test('plan done', () => {
    const html = render({ mins: 10, did: ['review', 'impact-drill'] });
    assert({
      given: 'a finished plan',
      should: 'offer the optional drill and say the review is caught up',
      actual: [
        html.includes('Done for today'),
        html.includes('Optional'),
        html.includes('All caught up'),
        html.includes('Recommended next'),
      ],
      expected: [true, true, true, false],
    });
  });

  test('without structure data the charts are left out', () => {
    const query = { mins: 20, did: [] } as const;
    const html = renderToString(
      h(TrainHub, {
        view: hubView({ ...sampleSummary, structure: null }, query),
        summary: { ...sampleSummary, structure: null },
        query,
      }),
    );
    assert({
      given: 'a summary with no structure history',
      should: 'show no charts',
      actual: html.includes('Structure on the first check'),
      expected: false,
    });
  });
});
