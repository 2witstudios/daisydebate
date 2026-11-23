import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { ThemeProvider } from '../ui/theme/theme-provider';
import type { ThemePreference } from '../features/theme/theme-preference';

setupRitewayBun();

/**
 * The browser chrome metas are head tags for the browser, not content for
 * assistive technology: they have no role or name, and the markup is the
 * contract.
 */
describe('ThemeProvider markup', () => {
  test('renders the browser chrome metas for the preference', () => {
    const metas = (initialPreference: ThemePreference) =>
      [
        ...renderMarkup(
          h(ThemeProvider, { initialPreference, children: null }),
        ).matchAll(/<meta ([^>]*?)\/?>/g),
      ].map((match) => match[1]);
    assert({
      given: 'the light and system preferences',
      should:
        'render the color-scheme meta and one theme-color meta per OS scheme',
      actual: [metas('light'), metas('system')],
      expected: [
        [
          'name="color-scheme" content="light"',
          'name="theme-color" media="(prefers-color-scheme: light)" content="#f5f0e4"',
          'name="theme-color" media="(prefers-color-scheme: dark)" content="#f5f0e4"',
        ],
        [
          'name="color-scheme" content="light dark"',
          'name="theme-color" media="(prefers-color-scheme: light)" content="#f5f0e4"',
          'name="theme-color" media="(prefers-color-scheme: dark)" content="#0d1812"',
        ],
      ],
    });
  });
});
