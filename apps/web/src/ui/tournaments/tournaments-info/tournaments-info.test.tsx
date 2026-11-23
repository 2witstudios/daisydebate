import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { TournamentsInfo } from './tournaments-info';

setupRitewayBun();

describe('TournamentsInfo', () => {
  const render = (tabReleased?: boolean) =>
    renderAccessible(
      h(TournamentsInfo, tabReleased === undefined ? {} : { tabReleased }),
    );

  test('reads the plans', () => {
    const view = render();
    assert({
      given: 'the Tournaments page',
      should: 'name each planned event and tabulation under one h1',
      actual: [
        view.count('heading', undefined, { level: 1 }),
        ...[
          'Public Beta Open',
          'Weekly round robins',
          'Seasonal qualifiers',
          'Championships',
          'Tabulation software',
        ].map((title) => view.textContent().includes(title)),
      ],
      expected: [1, true, true, true, true, true],
    });
  });

  test('is information only', () => {
    const view = render();
    assert({
      given: 'the Tournaments page',
      should: 'carry no Coming soon, button, link or form control',
      actual: [
        view.textContent().includes('Coming soon'),
        ...(
          [
            'button',
            'link',
            'form',
            'textbox',
            'combobox',
            'checkbox',
            'radio',
          ] as const
        ).map((role) => view.count(role, undefined, { hidden: true })),
      ],
      expected: [false, 0, 0, 0, 0, 0, 0, 0],
    });
  });

  test('with Daisy Tab released', () => {
    const plain = render().textContent();
    const view = render(true);
    const released = view.textContent();
    assert({
      given: 'a viewer Daisy Tab is released to, and one it is not',
      should:
        'say early access is open to the first and rolling out to the second, linking to the tournament directory for the released viewer',
      actual: [
        released.includes('Tabulation is open to your account in early access'),
        plain.includes('Tabulation is rolling out in early access'),
        view.all('link').map((link) => link.getAttribute('href')),
        released.includes('hybrid') || plain.includes('hybrid'),
      ],
      expected: [true, true, ['/tournaments/directory'], false],
    });
  });
});
