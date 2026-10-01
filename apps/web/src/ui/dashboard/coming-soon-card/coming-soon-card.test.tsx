import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ComingSoonCard } from './coming-soon-card';

setupRitewayBun();

describe('ComingSoonCard', () => {
  test('tags the card and links to the explainer', () => {
    const html = renderToString(
      h(ComingSoonCard, {
        title: 'Live now',
        body: 'Debates in progress will appear here.',
        href: '/coming-soon/watch',
      }),
    );
    assert({
      given: 'a coming-soon card',
      should: 'carry the title, body, Coming soon tag and a Learn more link',
      actual: [
        html.includes('Live now'),
        html.includes('Debates in progress will appear here.'),
        html.includes('Coming soon'),
        html.includes('href="/coming-soon/watch"'),
        html.includes('Learn more'),
      ],
      expected: [true, true, true, true, true],
    });
  });
});
