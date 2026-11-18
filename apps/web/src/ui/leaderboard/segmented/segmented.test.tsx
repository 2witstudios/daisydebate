import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Segmented } from './segmented';

setupRitewayBun();

describe('Segmented', () => {
  test('links with one current', () => {
    const html = renderToString(
      h(Segmented, {
        label: 'Scope',
        segments: [
          { label: 'Top', href: '/leaderboard', selected: true },
          {
            label: 'Around me',
            href: '/leaderboard?scope=around',
            selected: false,
          },
        ],
      }),
    );
    assert({
      given: 'two segments, the first current',
      should: 'render a labelled nav of links marking only the first current',
      actual: [
        html.includes('aria-label="Scope"'),
        html.match(/<a /g)?.length,
        html.match(/aria-current="page"/g)?.length,
        html.includes('href="/leaderboard?scope=around"'),
      ],
      expected: [true, 2, 1, true],
    });
  });

  test('a captioned row', () => {
    const segments = [{ label: 'Youth', href: '/a', selected: true }];
    const captioned = renderToString(
      h(Segmented, { label: 'Division', segments, captioned: true }),
    );
    const plain = renderToString(h(Segmented, { label: 'Division', segments }));
    assert({
      given: 'the same row with and without a caption',
      should: 'show the label as text only when captioned',
      actual: [
        captioned.includes('>Division</span>'),
        plain.includes('>Division</span>'),
      ],
      expected: [true, false],
    });
  });
});
