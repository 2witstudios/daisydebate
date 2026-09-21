import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Avatar } from './avatar';

setupRitewayBun();

describe('Avatar', () => {
  test('falls back to initials derived from the name', () => {
    const html = renderToString(h(Avatar, { name: 'Maya Singh' }));
    assert({
      given: 'an avatar without an image',
      should: 'render the two-word initials',
      actual: html.includes('MS'),
      expected: true,
    });
  });

  test('embeds a presence dot when presence is provided', () => {
    const html = renderToString(
      h(Avatar, { name: 'Maya Singh', presence: 'online' }),
    );
    assert({
      given: 'an avatar with online presence',
      should: 'render a presence status indicator',
      actual: html.includes('aria-label="online"'),
      expected: true,
    });
  });

  test('names the person accessibly', () => {
    const html = renderToString(h(Avatar, { name: 'Daniel Kim' }));
    assert({
      given: 'any avatar',
      should: 'carry the name for screen readers',
      actual: html.includes('Daniel Kim'),
      expected: true,
    });
  });
});
