import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { PRESENCE_ACTORS_MAX } from './presence-scripts';
import { createTestRedis } from './test-support';

setupRitewayBun();

test('readActorsPresence reads several actors in one op', async () => {
  const [a, b, c] = [createId(), createId(), createId()];
  const { redis, scriptEval, commands } = createTestRedis();
  scriptEval([5000, 'active', '', 'idle']);
  const presence = await redis.readActorsPresence([a, b, c]);
  const evalshas = commands.filter(({ command }) => command === 'EVALSHA');
  assert({
    given: 'three actors, one active, one offline and one idle',
    should:
      'issue one EVALSHA declaring each actor zset, then the conn prefix, the connection bound and the actor ids',
    actual: {
      evalCount: evalshas.length,
      evalArgs: evalshas[0]?.args.slice(1),
      presence: [...presence.entries()],
    },
    expected: {
      evalCount: 1,
      evalArgs: [
        '3',
        `test:v1:presence:actor:${a}`,
        `test:v1:presence:actor:${b}`,
        `test:v1:presence:actor:${c}`,
        'test:v1:presence:conn:',
        '32',
        a,
        b,
        c,
      ],
      presence: [
        [a, 'active'],
        [b, null],
        [c, 'idle'],
      ],
    },
  });
});

test('readActorsPresence bounds and validates its input', async () => {
  const { redis, commands } = createTestRedis();
  assert({
    given: 'no actors',
    should: 'answer an empty map without a round trip',
    actual: [(await redis.readActorsPresence([])).size, commands.length],
    expected: [0, 0],
  });
  const refused = async (ids: string[]) => {
    try {
      await redis.readActorsPresence(ids);
      return false;
    } catch {
      return true;
    }
  };
  assert({
    given: 'a malformed actor id or one actor over the bound',
    should: 'refuse both before any command',
    actual: [
      await refused(['not an id']),
      await refused(
        Array.from({ length: PRESENCE_ACTORS_MAX + 1 }, () => createId()),
      ),
      commands.length,
    ],
    expected: [true, true, 0],
  });
});

test('countOnlinePresence counts the live online set', async () => {
  const { redis, scriptEval, commands } = createTestRedis();
  scriptEval(7);
  assert({
    given: 'seven live actors',
    should: 'count them in one EVALSHA over the online key',
    actual: [
      await redis.countOnlinePresence(),
      commands.find(({ command }) => command === 'EVALSHA')?.args.slice(1),
    ],
    expected: [7, ['1', 'test:v1:presence:online']],
  });
});
