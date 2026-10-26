import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { stageColourClasses } from '../../test-support/stage-palette';
import { FirstVisit } from './first-visit';

setupRitewayBun();

describe('FirstVisit', () => {
  test('the empty library', () => {
    const html = renderToString(h(FirstVisit));
    assert({
      given: 'a library with nothing in it',
      should:
        'lead with one h1, offer the three starts as links, a team start and the privacy note',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('Start your debate library'),
        html.includes('href="/prep/cards/new"'),
        html.includes('href="/prep/briefs/new"'),
        html.includes('href="/prep/cards/new?src=file"'),
        html.includes('Create or join a team'),
        html.includes('href="/prep/privacy"'),
      ],
      expected: [1, true, true, true, true, true, true],
    });
  });
});

describe('FirstVisit hero', () => {
  test('sits on the page palette', () => {
    const html = renderToString(h(FirstVisit));
    assert({
      given: 'the start-your-library hero',
      should: 'draw on the accent tint with no stage colour',
      actual: {
        tint: /aria-labelledby="start-heading" class="[^"]*\bbg-accent-soft\b/.test(
          html,
        ),
        stage: stageColourClasses(html),
      },
      expected: { tint: true, stage: [] },
    });
  });
});
