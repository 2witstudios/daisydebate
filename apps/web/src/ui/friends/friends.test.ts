import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { friendsAround, friendsLede, relationTo } from './friends';

setupRitewayBun();

const friends = [
  { username: 'ada', presence: 'online' as const },
  { username: 'bea', presence: 'away' as const },
  { username: 'cat', presence: 'offline' as const },
];

describe('friendsAround', () => {
  test('counts online and away friends', () => {
    assert({
      given: 'an online, an away and an offline friend',
      should: 'count two around',
      actual: friendsAround(friends),
      expected: 2,
    });
  });
});

describe('friendsLede', () => {
  test('says how many are online, or how to start', () => {
    assert({
      given: 'three friends, and then none',
      should: 'count those around, or invite adding one',
      actual: [friendsLede({ friends }), friendsLede({ friends: [] })],
      expected: [
        '2 of 3 online',
        'Add a friend by username to see when they are online.',
      ],
    });
  });
});

describe('relationTo', () => {
  test('reads the viewer’s relation from their own list', () => {
    const list = {
      version: 1 as const,
      hidden: false,
      friends,
      incoming: [{ username: 'dan', requestedAt: '2026-10-26T18:00:00.000Z' }],
      outgoing: [{ username: 'eve', requestedAt: '2026-10-26T18:00:00.000Z' }],
      challenges: [],
    };
    assert({
      given: 'a friend, an incoming, an outgoing and a stranger, in any case',
      should: 'name each relation',
      actual: ['ADA', 'dan', 'eve', 'zed'].map((name) =>
        relationTo(list, name),
      ),
      expected: ['friends', 'incoming', 'outgoing', 'none'],
    });
  });
});
