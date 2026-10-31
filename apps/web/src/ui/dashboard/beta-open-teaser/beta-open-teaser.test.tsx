import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { BetaOpenTeaser } from './beta-open-teaser';

setupRitewayBun();

describe('BetaOpenTeaser', () => {
  test('tags the card and links to the explainer', () => {
    const html = renderToString(h(BetaOpenTeaser, {}));
    assert({
      given: 'the public beta open teaser',
      should:
        'carry the event name, Coming soon tag, TBD line and a Learn more link',
      actual: [
        html.includes('Public Beta Open'),
        html.includes('Coming soon'),
        html.includes('TBD'),
        html.includes('href="/coming-soon/tournaments"'),
        html.includes('Learn more'),
      ],
      expected: [true, true, true, true, true],
    });
  });
});
