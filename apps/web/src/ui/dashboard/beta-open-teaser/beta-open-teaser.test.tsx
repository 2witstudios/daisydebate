import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { BetaOpenTeaser } from './beta-open-teaser';

setupRitewayBun();

describe('BetaOpenTeaser', () => {
  test('names the event and links to the Tournaments page', () => {
    const view = renderAccessible(h(BetaOpenTeaser, {}));
    assert({
      given: 'the public beta open teaser',
      should:
        'carry the event name, TBD line and a Learn more link, with no Coming soon tag',
      actual: [
        view.has('heading', 'Public Beta Open', { level: 2 }),
        view.textContent().includes('Coming soon'),
        view.textContent().includes('TBD'),
        view.attribute('link', 'Learn more', 'href'),
      ],
      expected: [true, false, true, '/tournaments'],
    });
  });
});
