import { createElement as h } from 'react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderInStore } from '../../test-support/render-in-store';
import { FriendsPage } from './friends-page';

setupRitewayBun();

const at = '2026-10-26T18:00:00.000Z';
const action = async () => ({ username: '' });
const noop = () => {};
const router = {
  bfcacheId: 'test',
  back: noop,
  forward: noop,
  refresh: noop,
  push: noop,
  replace: noop,
  prefetch: noop,
};
const render = (list: Parameters<typeof FriendsPage>[0]['list']) =>
  renderInStore(
    h(
      AppRouterContext,
      { value: router },
      h(FriendsPage, { list, friendAction: action, challengeAction: action }),
    ),
  );

describe('FriendsPage', () => {
  test('friends online first, with requests both ways and what you can do', () => {
    const html = render({
      version: 1,
      friends: [
        { username: 'ada', presence: 'online' },
        { username: 'cat', presence: 'offline' },
      ],
      incoming: [{ username: 'dan', requestedAt: at }],
      outgoing: [{ username: 'eve', requestedAt: at }],
    });
    assert({
      given: 'two friends, one incoming and one sent request',
      should:
        'count who is online, show requests first, and offer each row its forms',
      actual: [
        html.includes('>Friends</h1>'),
        html.includes('1 of 2 online'),
        html.indexOf('>Requests</h2>') < html.indexOf('>Your friends</h2>'),
        html.indexOf('@ada') < html.indexOf('@cat'),
        html.includes('aria-label="Accept @dan"'),
        html.includes('aria-label="Challenge @ada"'),
        html.includes('aria-label="Remove @cat"'),
        html.includes('aria-label="Cancel @eve"'),
        html.includes('href="/profile/ada"'),
        html.includes('Watch'),
      ],
      expected: [true, true, true, true, true, true, true, true, true, false],
    });
  });

  test('a member with no friends sees how to add one', () => {
    const html = render({
      version: 1,
      friends: [],
      incoming: [],
      outgoing: [],
    });
    assert({
      given: 'an empty list',
      should: 'invite adding a friend by username with a native form',
      actual: [
        html.includes('Add a friend by username'),
        html.includes('name="username"'),
        html.includes('>Your friends</h2>'),
      ],
      expected: [true, true, false],
    });
  });

  test('an unavailable list still offers the add form', () => {
    const html = render(null);
    assert({
      given: 'no list',
      should: 'say friends are unavailable and keep the add form',
      actual: [
        html.includes('Friends are unavailable right now.'),
        html.includes('Send friend request'),
      ],
      expected: [true, true],
    });
  });
});
