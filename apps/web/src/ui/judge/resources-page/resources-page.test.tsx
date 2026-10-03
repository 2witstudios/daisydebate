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
        'have one h1, six cards, the qualify badge once and six sample actions',
      actual: [
        html.match(/<h1 /g)?.length,
        html.match(/<h2 /g)?.length,
        html.split('Needed to qualify').length - 1,
        html.match(/href="\?did=/g)?.length,
        html.includes('disabled=""'),
        html.includes('not written yet'),
        html.includes('Ratings stay hidden while you judge'),
      ],
      expected: [1, 6, 1, 6, false, false, true],
    });
  });
});
