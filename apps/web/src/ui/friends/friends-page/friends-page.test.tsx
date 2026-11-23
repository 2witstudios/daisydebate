import { createElement as h } from 'react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderInStore } from '../../test-support/render-in-store';
import { initialFriendForm } from '../../../features/friends/forms';
import { FriendsPage } from './friends-page';

setupRitewayBun();

const at = '2026-10-26T18:00:00.000Z';
const action = async () => initialFriendForm();
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
const render = (
  list: Parameters<typeof FriendsPage>[0]['list'],
  liveHrefs: ReadonlyMap<string, string> = new Map(),
) =>
  renderInStore(
    h(
      AppRouterContext,
      { value: router },
      h(FriendsPage, {
        list,
        friendAction: action,
        liveHrefs,
        message: (username: string) =>
          h('button', { type: 'submit' }, `Message @${username}`),
      }),
    ),
  );

describe('FriendsPage', () => {
  test('friends online first, with requests both ways and what you can do', () => {
    const view = render({
      version: 1,
      friends: [
        {
          username: 'ada',
          presence: 'online',
          displayName: null,
          photoId: null,
        },
        {
          username: 'cat',
          presence: 'offline',
          displayName: null,
          photoId: null,
        },
      ],
      incoming: [{ username: 'dan', requestedAt: at }],
      outgoing: [{ username: 'eve', requestedAt: at }],
    });
    const sections = view.names('heading', { level: 2 });
    const friends = view.within('region', 'Your friends').names('link');
    assert({
      given: 'two friends, one incoming and one sent request',
      should:
        'count who is online, show requests first, and offer each row its forms',
      actual: [
        view.has('heading', 'Friends', { level: 1 }),
        view.textContent().includes('1 of 2 online'),
        sections.indexOf('Requests') < sections.indexOf('Your friends'),
        friends.indexOf('@ada') < friends.indexOf('@cat'),
        view.has('button', 'Accept @dan'),
        view.has('button', 'Message @ada'),
        view.has('button', 'Message @dan'),
        view.has('button', 'Remove @cat'),
        view.has('button', 'Cancel @eve'),
        view.attribute('link', '@ada', 'href') === '/profile/ada',
        view.textContent().includes('Watch'),
      ],
      expected: [
        true,
        true,
        true,
        true,
        true,
        true,
        false,
        true,
        true,
        true,
        false,
      ],
    });
  });

  test('a friend who chose a display name and photo', () => {
    const photoId = 'f'.repeat(24);
    const view = render({
      version: 1,
      friends: [
        {
          username: 'ada',
          presence: 'online',
          displayName: 'Ada Byron',
          photoId,
        },
      ],
      incoming: [],
      outgoing: [],
    });
    assert({
      given: 'a friend with a display name and published photo',
      should:
        'name them by it, keep @username and their status beside it, and show the small photo',
      actual: [
        view.attribute('link', 'Ada Byron', 'href'),
        view.textContent().includes('@ada · Online'),
        view.attribute('presentation', undefined, 'src'),
      ],
      expected: ['/profile/ada', true, `/api/profile-photos/${photoId}/128`],
    });
  });

  test('a member with no friends sees how to add one', () => {
    const view = render({
      version: 1,
      friends: [],
      incoming: [],
      outgoing: [],
    });
    assert({
      given: 'an empty list',
      should:
        'invite adding a friend by username with a native form, and no status control: that lives in the account menu',
      actual: [
        view.textContent().includes('Add a friend by username'),
        view.attribute('textbox', 'Username', 'name'),
        view.has('heading', 'Your friends', { level: 2 }),
        view.textContent().includes('Presence control'),
      ],
      expected: [true, 'username', false, false],
    });
  });

  test('an unavailable list still offers the add form', () => {
    const view = render(null);
    assert({
      given: 'no list',
      should: 'say friends are unavailable and keep the add form',
      actual: [
        view.textContent().includes('Friends are unavailable right now.'),
        view.has('button', 'Send friend request'),
      ],
      expected: [true, true],
    });
  });

  test('a friend live in a public Round', () => {
    const view = render(
      {
        version: 1,
        friends: [
          {
            username: 'ada',
            presence: 'online',
            displayName: null,
            photoId: null,
          },
          {
            username: 'cat',
            presence: 'offline',
            displayName: null,
            photoId: null,
          },
        ],
        incoming: [],
        outgoing: [],
      },
      new Map([['ada', '/watch/round-of-ada']]),
    );
    assert({
      given: 'one friend live and one not',
      should: 'offer Watch live for the live one only',
      actual: [
        view.attribute('link', 'Watch @ada live', 'href'),
        view.count('link', /^Watch @.+ live$/),
        view.textContent().split('Watch live').length - 1,
      ],
      expected: ['/watch/round-of-ada', 1, 1],
    });
  });
});
