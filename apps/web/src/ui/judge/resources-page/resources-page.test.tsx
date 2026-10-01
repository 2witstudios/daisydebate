import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { listJudgeResources } from '../../../features/judge/list-judge-resources';
import { ResourcesPage } from './resources-page';

setupRitewayBun();

describe('ResourcesPage', () => {
  test('all six resources', () => {
    const html = renderToString(
      h(ResourcesPage, { resources: listJudgeResources() }),
    );
    assert({
      given: 'the six sample resources',
      should:
        'have one h1, six cards, the qualify badge once and six inert buttons with reasons',
      actual: [
        html.match(/<h1 /g)?.length,
        html.match(/<h2 /g)?.length,
        html.split('Needed to qualify').length - 1,
        html.match(/<button [^>]*disabled=""/g)?.length,
        html.includes('This guide is not written yet.'),
        html.includes('Practice debates are not recorded yet.'),
        html.includes('Ratings stay hidden while you judge'),
      ],
      expected: [1, 6, 1, 6, true, true, true],
    });
  });
});
