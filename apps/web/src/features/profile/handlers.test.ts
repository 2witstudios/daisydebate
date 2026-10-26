import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Identity } from '@daisy/auth';
import { memberProfileSchema } from '@daisy/protocol';
import { silentLogger } from '../../server/test-loggers.test-support';
import { allowEvery } from '../auth/abuse/limiter.test-support';
import { createProfileHandlers } from './handlers';
import type { ProfileStore } from './read-profile';

setupRitewayBun();

const owner = {
  userId: 'u'.repeat(24),
  actorId: 'a'.repeat(24),
  username: 'debater-a',
  memberSince: '2026-09-01T00:00:00.000Z',
};
const visitor: Identity = {
  state: 'anonymous',
  principal: { kind: 'anonymous' },
};
const signedIn = (userId: string): Identity => ({
  state: 'member',
  username: 'viewer',
  principal: { kind: 'user', userId, actorId: 'b'.repeat(24) },
});

const handlerWith = (identity: Identity) => {
  const reads: { publicOnly: boolean; before: string | null }[] = [];
  const keys: string[] = [];
  const store: ProfileStore = {
    readMember: async (username) => (username === 'debater-a' ? owner : null),
    readRecordGroups: async () => [],
    readMatchHistory: async (input) => {
      reads.push({ publicOnly: input.publicOnly, before: input.before });
      return { rows: [], nextBefore: null };
    },
  };
  const { read } = createProfileHandlers({
    logger: silentLogger,
    origin: () => 'http://localhost:3000',
    identify: async () => identity,
    limiter: () => ({
      consume: async (key: string) => {
        keys.push(key);
        return allowEvery();
      },
    }),
    store,
  });
  return { read, reads, keys };
};

const get = (username: string, search = '') =>
  new Request(`http://localhost:3000/api/profiles/${username}${search}`);

describe('GET /api/profiles/:username', () => {
  test('a visitor', async () => {
    const { read, reads } = handlerWith(visitor);
    const response = await read(get('Debater-A'), 'Debater-A');
    assert({
      given: 'a visitor naming a member in any case',
      should: 'answer the contract, not as theirs, over public Rounds only',
      actual: [
        response.status,
        memberProfileSchema.safeParse(await response.json()).data?.me,
        reads,
      ],
      expected: [200, false, [{ publicOnly: true, before: null }]],
    });
  });

  test('the owner, paging back', async () => {
    const { read, reads, keys } = handlerWith(signedIn(owner.userId));
    const response = await read(
      get('debater-a', `?before=${'r'.repeat(24)}`),
      'debater-a',
    );
    assert({
      given: 'the signed-in owner with a history cursor',
      should: 'read all their Rounds before it, rate limited per member',
      actual: [response.status, reads, keys],
      expected: [
        200,
        [{ publicOnly: false, before: 'r'.repeat(24) }],
        [`profile:read:${owner.userId}`],
      ],
    });
  });

  test('refusals', async () => {
    const { read, reads } = handlerWith(signedIn('c'.repeat(24)));
    const statuses = [
      (await read(get('nobody-here'), 'nobody-here')).status,
      (await read(get('no!'), 'no!')).status,
      (await read(get('debater-a', '?before=bad'), 'debater-a')).status,
      (await read(get('debater-a', '?before=a&before=b'), 'debater-a')).status,
      (await read(get('debater-a', '?rating=1'), 'debater-a')).status,
    ];
    assert({
      given:
        'an unknown name, a malformed name, a bad cursor, a repeated cursor and an unknown parameter',
      should: 'answer 404, 404, 400, 400, 400 and read no history',
      actual: [statuses, reads],
      expected: [[404, 404, 400, 400, 400], []],
    });
  });

  test('an unreadable session', async () => {
    const { read, reads } = handlerWith({
      state: 'unavailable',
      principal: { kind: 'anonymous' },
    });
    assert({
      given: 'a session store outage',
      should: 'answer 503 rather than a visitor’s view',
      actual: [(await read(get('debater-a'), 'debater-a')).status, reads],
      expected: [503, []],
    });
  });

  test('a cross-site read', async () => {
    const { read } = handlerWith(visitor);
    const response = await read(
      new Request('http://localhost:3000/api/profiles/debater-a', {
        headers: { 'sec-fetch-site': 'cross-site' },
      }),
      'debater-a',
    );
    assert({
      given: 'a cross-site browser read',
      should: 'refuse it',
      actual: response.status,
      expected: 403,
    });
  });
});
