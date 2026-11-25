import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../test-support/rendered/accessible';
import type { ShellRatings } from '../layout/app-shell/account';
import { SelfCard } from './self-card';

setupRitewayBun();

// Still reading: the card never waits on the rating, so it renders without it.
const reading = new Promise<ShellRatings>(() => {});

const card = (overrides: Partial<Parameters<typeof SelfCard>[0]> = {}) =>
  renderAccessible(
    h(SelfCard, {
      username: 'ada-byron',
      displayName: null,
      photoId: null,
      ratings: reading,
      statusControl: h('form', { 'aria-label': 'Status' }),
      ...overrides,
    }),
  );

describe('SelfCard', () => {
  test('one row: your status behind the avatar, your name to your profile', () => {
    const view = card();
    const you = view.within('region', 'You');
    assert({
      given: 'a member with no display name',
      should:
        'link the username to their profile, show @username, and keep the status choices in a disclosure',
      actual: [
        you.attribute('link', /ada-byron/, 'href'),
        you.textContent().includes('@ada-byron'),
        you.has('group'),
        you.has('form', 'Status', { hidden: true }),
      ],
      expected: ['/profile/ada-byron', true, true, true],
    });
  });

  test('a member who chose a display name and photo', () => {
    const photoId = 'f'.repeat(24);
    const you = card({ displayName: 'Ada Byron', photoId }).within(
      'region',
      'You',
    );
    assert({
      given: 'a member with a display name and published photo',
      should: 'show the display name over @username, and the photo',
      actual: [
        you.attribute('link', /^Ada Byron/, 'href'),
        you.textContent().includes('@ada-byron'),
        you
          .all('presentation')
          .map((photo) => photo.getAttribute('src'))
          .includes(`/api/profile-photos/${photoId}/128`),
      ],
      expected: ['/profile/ada-byron', true, true],
    });
  });

  test('compact is the avatar alone, opening with your name and status', () => {
    const view = card({ compact: true });
    assert({
      given: 'the mini people rail',
      should:
        'show only the disclosure, which opens with the link to your profile above the status choices',
      actual: [
        view.has('region', 'You'),
        view.within('group').attribute('link', /ada-byron/, 'href', {
          hidden: true,
        }),
        view.within('group').has('form', 'Status', { hidden: true }),
      ],
      expected: [false, '/profile/ada-byron', true],
    });
  });

  test('compact with no status read links the avatar to your profile', () => {
    const view = renderAccessible(
      h(SelfCard, {
        compact: true,
        username: 'ada-byron',
        displayName: null,
        photoId: null,
        ratings: reading,
      }),
    );
    assert({
      given: 'the mini rail when the status could not be read',
      should: 'still reach your profile from the avatar',
      actual: view.attribute('link', 'Your profile, ada-byron', 'href'),
      expected: '/profile/ada-byron',
    });
  });

  test('with no status read, the avatar is no control', () => {
    const view = renderAccessible(
      h(SelfCard, {
        username: 'ada-byron',
        displayName: null,
        photoId: null,
        ratings: reading,
      }),
    );
    assert({
      given: 'a card whose status could not be read',
      should: 'show the avatar without a disclosure',
      actual: view.has('group'),
      expected: false,
    });
  });
});
