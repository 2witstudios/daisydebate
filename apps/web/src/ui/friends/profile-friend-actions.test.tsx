import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ProfileFriendActions } from './profile-friend-actions';

setupRitewayBun();

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
const action = async () => ({ username: '' });
const render = (relation: 'none' | 'friends' | 'incoming' | 'outgoing') =>
  renderToString(
    h(
      AppRouterContext,
      { value: router },
      h(ProfileFriendActions, {
        username: 'ada',
        relation,
        friendAction: action,
        challengeAction: action,
      }),
    ),
  );

test('ProfileFriendActions', () => {
  assert({
    given: 'each relation the viewer can have to the member',
    should: 'offer the one native form that fits it',
    actual: (['none', 'friends', 'incoming', 'outgoing'] as const).map(
      (relation) => {
        const html = render(relation);
        return [
          html.match(/aria-label="([^"]+)"/)?.[1],
          html.match(/name="intent" value="([^"]+)"/)?.[1],
        ];
      },
    ),
    expected: [
      ['Add friend @ada', 'request'],
      ['Challenge @ada', 'challenge'],
      ['Accept friend request @ada', 'accept'],
      ['Cancel friend request @ada', 'cancel'],
    ],
  });
});
