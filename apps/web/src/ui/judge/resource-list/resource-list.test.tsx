import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { hubResources } from '../../../features/judge/resources';
import { listJudgeResources } from '../../../features/judge/list-judge-resources';
import { ResourceList } from './resource-list';

setupRitewayBun();

describe('ResourceList', () => {
  test('the hub list', () => {
    const html = renderToString(
      h(ResourceList, { resources: hubResources(listJudgeResources()) }),
    );
    assert({
      given: 'the four hub resources',
      should:
        'list each title as a link to the resources page plus All resources',
      actual: [
        html.includes('aria-label="Resources"'),
        html.split('href="/judge/resources"').length - 1,
        html.includes('Judging guide'),
        html.includes('Practice judging'),
        html.includes('Example ballots and reasons'),
        html.includes('How judge rating works'),
        html.includes('All resources'),
      ],
      expected: [true, 5, true, true, true, true, true],
    });
  });
});
