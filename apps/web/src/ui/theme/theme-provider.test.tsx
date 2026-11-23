import { createElement as h } from 'react';
import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { ThemeProvider, useThemePreference } from './theme-provider';
import type { ThemePreference } from '../../features/theme/theme-preference';

setupRitewayBun();

function Probe() {
  const { preference } = useThemePreference();
  return h('p', null, preference);
}

/** What the consumer rendered, beside the provider's own <meta> tags. */
const probed = (initialPreference: ThemePreference) =>
  renderAccessible(
    h(ThemeProvider, { initialPreference, children: h(Probe) }),
  ).text('paragraph');

describe('ThemeProvider', () => {
  test('serves the request preference to the first render', () => {
    assert({
      given: 'a provider seeded with the light preference',
      should: 'render consumers with light on the server',
      actual: probed('light'),
      expected: 'light',
    });
  });

  test('keeps concurrent requests apart', () => {
    assert({
      given: 'two providers rendered with different preferences',
      should: 'render each with its own preference',
      actual: [probed('system'), probed('dark')],
      expected: ['system', 'dark'],
    });
  });

  test('rejects a consumer outside the provider', () => {
    expect(() => renderAccessible(h(Probe))).toThrow(
      'useThemePreference must be used inside ThemeProvider',
    );
  });
});
