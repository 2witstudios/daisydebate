import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ProfileActions } from './profile-actions';

setupRitewayBun();

const render = (me: boolean) =>
  renderToString(h(ProfileActions, { username: 'debater-a', me }));

describe('ProfileActions', () => {
  test('your own profile', () => {
    const html = render(true);
    assert({
      given: 'the owner of the profile',
      should: 'offer a link to Settings',
      actual: [html.includes('>Settings<'), html.includes('href="/settings"')],
      expected: [true, true],
    });
  });

  test('someone else’s profile', () => {
    const html = render(false);
    assert({
      given: 'another member’s profile',
      should: 'name the member and offer no edit link',
      actual: [
        html.includes('aria-label="Actions for @debater-a"'),
        html.includes('>Settings<'),
      ],
      expected: [true, false],
    });
  });

  test('actions toward another member', () => {
    const toward = (me: boolean) =>
      renderToString(
        h(
          ProfileActions,
          { username: 'debater-a', me },
          h('button', null, 'Add friend'),
        ),
      ).includes('Add friend');
    assert({
      given: 'actions toward the member on their profile and on your own',
      should: 'show them only on someone else’s profile',
      actual: [toward(false), toward(true)],
      expected: [true, false],
    });
  });
});
