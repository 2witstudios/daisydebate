import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { ReadyStep } from './ready';

setupRitewayBun();

const render = (homeHref = '/lobby') =>
  renderAccessible(h(ReadyStep, { homeHref }));

describe('ReadyStep', () => {
  test('one simple send-off', () => {
    const view = render();
    const page = view.textContent();
    assert({
      given: 'the last step',
      should:
        'offer one CTA to the lobby and the beta line, with nothing else to do',
      actual: [
        page.includes(`You're ready`),
        page.includes(
          'Everything is set up. The lobby is where debates start. Jump in whenever you like.',
        ),
        view.attribute('link', 'Enter the lobby', 'href'),
        page.includes(`You're one of the first inside`),
        [
          page.includes('Debate a bot'),
          page.includes('Debate a real person'),
          page.includes('Edit'),
          page.includes('club'),
        ].some((leftover) => leftover),
      ],
      expected: [true, true, '/lobby', true, false],
    });
  });
});
