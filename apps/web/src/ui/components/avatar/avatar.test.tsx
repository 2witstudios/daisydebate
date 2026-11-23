import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { Avatar } from './avatar';

setupRitewayBun();

describe('Avatar', () => {
  test('falls back to initials derived from the name', () => {
    const view = renderAccessible(h(Avatar, { name: 'Maya Singh' }));
    assert({
      given: 'an avatar without an image',
      should: 'render the two-word initials',
      actual: view.textContent().includes('MS'),
      expected: true,
    });
  });

  test('embeds a presence dot when presence is provided', () => {
    const view = renderAccessible(
      h(Avatar, { name: 'Maya Singh', presence: 'online' }),
    );
    assert({
      given: 'an avatar with online presence',
      should: 'render a presence status indicator',
      actual: view.has('img', 'Online'),
      expected: true,
    });
  });

  test('names the person accessibly', () => {
    const view = renderAccessible(h(Avatar, { name: 'Daniel Kim' }));
    assert({
      given: 'any avatar',
      should: 'carry the name for screen readers',
      actual: view.textContent().includes('Daniel Kim'),
      expected: true,
    });
  });

  test('drops its own accessible name when the caller already shows it', () => {
    const view = renderAccessible(
      h(Avatar, { name: 'Daniel Kim', nameVisible: true }),
    );
    assert({
      given: 'an avatar next to visible name text the caller renders itself',
      should: 'not repeat the name in a sr-only span',
      actual: view.textContent().includes('Daniel Kim'),
      expected: false,
    });
  });

  test('sets explicit dimensions on an image avatar', () => {
    const view = renderAccessible(
      h(Avatar, { name: 'Daniel Kim', src: '/d.jpg', size: 'lg' }),
    );
    assert({
      given: 'an avatar with a photo at the lg size',
      should: 'set width and height to avoid a layout shift while it loads',
      actual: [
        view.attribute('presentation', undefined, 'width'),
        view.attribute('presentation', undefined, 'height'),
      ],
      expected: ['44', '44'],
    });
  });
});
