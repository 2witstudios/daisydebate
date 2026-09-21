import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { IconButton } from './icon-button';

setupRitewayBun();

describe('IconButton', () => {
  test('exposes its label as the accessible name', () => {
    const html = renderToString(
      h(IconButton, { name: 'bell', label: 'Notifications' }),
    );
    assert({
      given: 'an icon-only button',
      should: 'name the button, keep the icon decorative, and never submit',
      actual: [
        html.includes('aria-label="Notifications"'),
        html.includes('title="Notifications"'),
        html.includes('type="button"'),
        /<svg[^>]* aria-hidden="true"/.test(html),
      ],
      expected: [true, true, true, true],
    });
  });

  test('passes native button attributes and classes through', () => {
    const html = renderToString(
      h(IconButton, {
        name: 'swords',
        label: 'Challenge',
        className: 'extra',
        disabled: true,
      }),
    );
    assert({
      given: 'a disabled icon button with a caller class',
      should: 'render disabled and keep the caller class',
      actual: [
        html.includes('disabled=""'),
        /<button[^>]* class="[^"]*extra"/.test(html),
      ],
      expected: [true, true],
    });
  });
});
