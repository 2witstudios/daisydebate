import { createElement as h } from 'react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { initialFriendForm } from '../../features/friends/forms';
import { renderAccessible } from '../../test-support/rendered/accessible';
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
const action = async () => initialFriendForm();
const render = (relation: 'none' | 'friends' | 'incoming' | 'outgoing') =>
  renderAccessible(
    h(
      AppRouterContext,
      { value: router },
      h(ProfileFriendActions, {
        username: 'ada',
        relation,
        friendAction: action,
      }),
    ),
  );

test('ProfileFriendActions', () => {
  assert({
    given: 'each relation the viewer can have to the member',
    should: 'offer the one native form that fits it',
    actual: (['none', 'friends', 'incoming', 'outgoing'] as const).map(
      (relation) => {
        const view = render(relation);
        const form = view.all('button')[0]?.closest('form');
        const intent = form?.elements.namedItem('intent') as
          HTMLInputElement | null | undefined;
        return [view.names('button'), intent?.value];
      },
    ),
    expected: [
      [['Add friend @ada'], 'request'],
      [[], undefined],
      [['Accept friend request @ada'], 'accept'],
      [['Cancel friend request @ada'], 'cancel'],
    ],
  });
});
