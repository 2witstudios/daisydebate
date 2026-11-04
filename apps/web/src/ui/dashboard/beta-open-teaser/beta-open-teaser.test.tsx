import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { BetaOpenTeaser } from './beta-open-teaser';

setupRitewayBun();

describe('BetaOpenTeaser', () => {
  test('names the event and links to the Tournaments page', () => {
    const html = renderToString(h(BetaOpenTeaser, {}));
    assert({
      given: 'the public beta open teaser',
      should:
        'carry the event name, TBD line and a Learn more link, with no Coming soon tag',
      actual: [
        html.includes('Public Beta Open'),
        html.includes('Coming soon'),
        html.includes('TBD'),
        html.includes('href="/tournaments"'),
        html.includes('Learn more'),
      ],
      expected: [true, false, true, true, true],
    });
  });
});
