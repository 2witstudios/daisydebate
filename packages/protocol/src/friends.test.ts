import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  friendCommandSchemas,
  friendListSchema,
  onlineCountsSchema,
} from './friends';

setupRitewayBun();

test('friend commands', () => {
  assert({
    given: 'a request naming a padded mixed-case username',
    should: 'canonicalize the username',
    actual: friendCommandSchemas.request.parse({
      version: 1,
      username: ' Ada_L ',
    }),
    expected: { version: 1, username: 'ada_l' },
  });
  assert({
    given: 'a request carrying the acting actor id',
    should: 'refuse the unknown field',
    actual: friendCommandSchemas.request.safeParse({
      version: 1,
      username: 'ada',
      actorId: 'a'.repeat(24),
    }).success,
    expected: false,
  });
  assert({
    given: 'an invalid username or an unknown decision',
    should: 'refuse both',
    actual: [
      friendCommandSchemas.remove.safeParse({ version: 1, username: 'a b' })
        .success,
      friendCommandSchemas.respond.safeParse({
        version: 1,
        username: 'ada',
        decision: 'block',
      }).success,
    ],
    expected: [false, false],
  });
});

test('friend reads', () => {
  assert({
    given: 'a friend list with an unknown presence',
    should: 'refuse it',
    actual: friendListSchema.safeParse({
      version: 1,
      hidden: false,
      friends: [{ username: 'ada', presence: 'in-debate' }],
      incoming: [],
      outgoing: [],
      challenges: [],
    }).success,
    expected: false,
  });
  assert({
    given: 'a negative count',
    should: 'refuse it',
    actual: onlineCountsSchema.safeParse({
      version: 1,
      friendsOnline: -1,
      membersOnline: 0,
    }).success,
    expected: false,
  });
});

test('challenge commands', () => {
  assert({
    given: 'a challenge naming a friend and a room, and one with a bad room id',
    should: 'accept the first and refuse the second',
    actual: [
      friendCommandSchemas.challenge.safeParse({
        version: 1,
        username: 'ada',
        roomId: 'r'.repeat(24),
      }).success,
      friendCommandSchemas.declineChallenge.safeParse({
        version: 1,
        username: 'ada',
        roomId: 'not-a-room',
      }).success,
    ],
    expected: [true, false],
  });
});

test('the presence setting command', () => {
  assert({
    given: 'a boolean choice, and a choice naming another member',
    should: 'accept the first and refuse the second',
    actual: [
      friendCommandSchemas.presence.safeParse({ version: 1, hidden: true })
        .success,
      friendCommandSchemas.presence.safeParse({
        version: 1,
        hidden: true,
        username: 'ada',
      }).success,
    ],
    expected: [true, false],
  });
});
