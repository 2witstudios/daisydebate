import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  friendDoneNotice,
  friendFormUnavailable,
  friendRefusalNotice,
  friendRouteFor,
  parseFriendForm,
} from './forms';

setupRitewayBun();

const form = (entries: readonly (readonly [string, string])[]) => {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
};

test('parseFriendForm', async () => {
  assert({
    given: 'an intent and a username',
    should: 'read both',
    actual: parseFriendForm(
      form([
        ['intent', 'accept'],
        ['username', 'ada'],
      ]),
    ),
    expected: { intent: 'accept', username: 'ada' },
  });
  await assertRejects({
    given: 'an unknown intent',
    should: 'refuse it',
    actual: async () =>
      parseFriendForm(
        form([
          ['intent', 'block'],
          ['username', 'ada'],
        ]),
      ),
    code: 'VALIDATION',
  });
  await assertRejects({
    given: 'a repeated username',
    should: 'refuse it',
    actual: async () =>
      parseFriendForm(
        form([
          ['intent', 'request'],
          ['username', 'ada'],
          ['username', 'bea'],
        ]),
      ),
    code: 'VALIDATION',
  });
});

test('friendRouteFor', () => {
  assert({
    given: 'each intent',
    should: 'post requests, answers and removals to their own routes',
    actual: (['request', 'accept', 'decline', 'cancel', 'remove'] as const).map(
      (intent) => {
        const { path, body } = friendRouteFor(intent, 'ada');
        return [path, body];
      },
    ),
    expected: [
      ['/api/friends', { version: 1, username: 'ada' }],
      [
        '/api/friends/respond',
        { version: 1, username: 'ada', decision: 'accept' },
      ],
      [
        '/api/friends/respond',
        { version: 1, username: 'ada', decision: 'decline' },
      ],
      ['/api/friends/remove', { version: 1, username: 'ada' }],
      ['/api/friends/remove', { version: 1, username: 'ada' }],
    ],
  });
});

test('notices', () => {
  assert({
    given: 'a request answered by a reciprocal one, and a plain request',
    should: 'say friends, or say the request was sent',
    actual: [
      friendDoneNotice('request', 'ada', 'friends'),
      friendDoneNotice('request', 'ada', 'outgoing'),
    ],
    expected: ['You and @ada are now friends.', 'Friend request sent to @ada.'],
  });
  assert({
    given: 'a refused request for an unknown or blocked member',
    should: 'give one message that names neither cause',
    actual: friendRefusalNotice('request', 404),
    expected:
      'No member with that username can take a friend request from you.',
  });
  assert({
    given: 'a failed call',
    should: 'keep the typed username',
    actual: friendFormUnavailable(form([['username', 'ad']])).username,
    expected: 'ad',
  });
});
