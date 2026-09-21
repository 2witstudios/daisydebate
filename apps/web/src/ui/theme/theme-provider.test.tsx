import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ThemeProvider, useThemePreference } from './theme-provider';

setupRitewayBun();

function Probe() {
  const { preference } = useThemePreference();
  return h('p', null, preference);
}

describe('ThemeProvider', () => {
  test('serves the request preference to the first render', () => {
    assert({
      given: 'a provider seeded with the light preference',
      should: 'render consumers with light on the server',
      actual: renderToString(
        h(ThemeProvider, { initialPreference: 'light', children: h(Probe) }),
      ),
      expected: '<p>light</p>',
    });
  });

  test('keeps concurrent requests apart', () => {
    assert({
      given: 'two providers rendered with different preferences',
      should: 'render each with its own preference',
      actual: [
        renderToString(
          h(ThemeProvider, { initialPreference: 'system', children: h(Probe) }),
        ),
        renderToString(
          h(ThemeProvider, { initialPreference: 'dark', children: h(Probe) }),
        ),
      ],
      expected: ['<p>system</p>', '<p>dark</p>'],
    });
  });

  test('rejects a consumer outside the provider', () => {
    expect(() => renderToString(h(Probe))).toThrow(
      'useThemePreference must be used inside ThemeProvider',
    );
  });
});
