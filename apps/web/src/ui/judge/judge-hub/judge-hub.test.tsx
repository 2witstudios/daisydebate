import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getJudgeRating } from '../../../features/judge/get-judge-rating';
import { listJudgeResources } from '../../../features/judge/list-judge-resources';
import { JudgeHub } from './judge-hub';

setupRitewayBun();

describe('JudgeHub', () => {
  test('the hub', () => {
    const html = renderToString(
      h(JudgeHub, {
        rating: getJudgeRating(),
        resources: listJudgeResources(),
      }),
    );
    assert({
      given: 'the sample judge and resources',
      should:
        'have one h1, the start panel, the rating card and the four hub resources',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('aria-label="Start judging"'),
        html.includes('aria-label="Your judge rating"'),
        html.includes('aria-label="Resources"'),
        html.includes('Judging guide'),
        html.includes('The ballot, criterion by criterion'),
      ],
      expected: [1, true, true, true, true, false],
    });
  });
});
