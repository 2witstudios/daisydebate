import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { ProfileActions } from './profile-actions';

setupRitewayBun();

const render = (me: boolean) =>
  renderAccessible(h(ProfileActions, { username: 'debater-a', me }));

describe('ProfileActions', () => {
  test('your own profile', () => {
    const view = render(true);
    assert({
      given: 'the owner of the profile',
      should: 'offer Edit profile, leading to Settings’ Profile section',
      actual: [
        view.has('group', 'Your profile actions'),
        view.attribute('link', 'Edit profile', 'href'),
      ],
      expected: [true, '/settings#profile'],
    });
  });

  test('someone else’s profile', () => {
    const view = render(false);
    assert({
      given: 'another member’s profile',
      should: 'name the member and offer no edit link',
      actual: [
        view.has('group', 'Actions for @debater-a'),
        view.textContent().includes('Edit profile'),
      ],
      expected: [true, false],
    });
  });

  test('actions toward another member', () => {
    const toward = (me: boolean) =>
      renderAccessible(
        h(
          ProfileActions,
          { username: 'debater-a', me },
          h('button', null, 'Add friend'),
        ),
      ).has('button', 'Add friend');
    assert({
      given: 'actions toward the member on their profile and on your own',
      should: 'show them only on someone else’s profile',
      actual: [toward(false), toward(true)],
      expected: [true, false],
    });
  });
});
