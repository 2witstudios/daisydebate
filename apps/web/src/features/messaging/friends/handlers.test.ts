import { assert, setupRitewayBun, test } from 'riteway/bun';
import { silentLogger } from '../../../server/test-loggers.test-support';
import { createFriendHandlers } from './handlers';

setupRitewayBun();

const origin = 'https://daisy.example';
const member = {
  state: 'member' as const,
  username: 'me',
  principal: {
    kind: 'user' as const,
    userId: 'u'.repeat(24),
    actorId: 'a'.repeat(24),
  },
};

const harness = (identity: unknown = member) => {
  const calls: unknown[][] = [];
  const handlers = createFriendHandlers({
    boundary: {
      logger: silentLogger,
      origin: () => origin,
      identify: async () => identity as never,
    },
    change: async (_principal, command, username) => {
      calls.push([command, username]);
      return { username, relation: 'outgoing' };
    },
    challenge: async (_principal, command, input) => {
      calls.push([command, input.username, input.roomId]);
      return { username: input.username, relation: 'friends' };
    },
    list: async () => ({
      friends: [],
      incoming: [],
      outgoing: [],
      challenges: [],
    }),
    counts: async () => ({ friendsOnline: 2, membersOnline: 9 }),
    websocketEndpoint: 'wss://realtime.daisy.example/ws',
  });
  return { handlers, calls };
};

const post = (path: string, body: unknown, from = origin) =>
  new Request(`${origin}${path}`, {
    method: 'POST',
    headers: { origin: from, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('each write route parses its own command for the principal', async () => {
  const { handlers, calls } = harness();
  const responses = await Promise.all([
    handlers.request(post('/api/friends', { version: 1, username: 'Ada' })),
    handlers.respond(
      post('/api/friends/respond', {
        version: 1,
        username: 'bea',
        decision: 'decline',
      }),
    ),
    handlers.remove(
      post('/api/friends/remove', { version: 1, username: 'cat' }),
    ),
  ]);
  assert({
    given: 'a request, a decline and a removal',
    should: 'answer 200 with the result and pass each command on',
    actual: [
      responses.map((response) => response.status),
      await responses[0]!.json(),
      calls,
    ],
    expected: [
      [200, 200, 200],
      { version: 1, username: 'ada', relation: 'outgoing' },
      [
        ['request', 'ada'],
        ['decline', 'bea'],
        ['remove', 'cat'],
      ],
    ],
  });
});

test('refusals before any change', async () => {
  const { handlers, calls } = harness();
  const foreign = await handlers.request(
    post(
      '/api/friends',
      { version: 1, username: 'ada' },
      'https://evil.example',
    ),
  );
  const invalid = await handlers.request(
    post('/api/friends', { version: 1, username: 'a b' }),
  );
  const visitor = await harness({
    state: 'anonymous',
    principal: { kind: 'anonymous' },
  }).handlers.request(post('/api/friends', { version: 1, username: 'ada' }));
  assert({
    given: 'a foreign origin, a bad username and a visitor',
    should: 'refuse 403, 400 and 401 and change nothing',
    actual: [foreign.status, invalid.status, visitor.status, calls],
    expected: [403, 400, 401, []],
  });
});

test('the counts read names the realtime endpoint and is never cached', async () => {
  const response = await harness().handlers.counts(
    new Request(`${origin}/api/friends/online`, {
      headers: { 'sec-fetch-site': 'same-origin' },
    }),
  );
  assert({
    given: 'a member reading the online counts',
    should: 'answer the counts with the socket endpoint and no-store',
    actual: [
      await response.json(),
      response.headers.get('x-realtime-socket-url'),
      response.headers.get('cache-control'),
    ],
    expected: [
      { version: 1, friendsOnline: 2, membersOnline: 9 },
      'wss://realtime.daisy.example/ws',
      'no-store',
    ],
  });
});

test('the list read answers the member’s own list', async () => {
  const response = await harness().handlers.list(
    new Request(`${origin}/api/friends`),
  );
  assert({
    given: 'a member reading their list',
    should: 'answer the versioned list',
    actual: [response.status, await response.json()],
    expected: [
      200,
      { version: 1, friends: [], incoming: [], outgoing: [], challenges: [] },
    ],
  });
});

test('the challenge routes carry a friend and a room', async () => {
  const { handlers, calls } = harness();
  const room = 'r'.repeat(24);
  const responses = await Promise.all([
    handlers.challenge(
      post('/api/friends/challenges', {
        version: 1,
        username: 'Bea',
        roomId: room,
      }),
    ),
    handlers.declineChallenge(
      post('/api/friends/challenges/decline', {
        version: 1,
        username: 'cat',
        roomId: room,
      }),
    ),
    handlers.challenge(
      post('/api/friends/challenges', {
        version: 1,
        username: 'bea',
        roomId: 'x',
      }),
    ),
  ]);
  assert({
    given: 'a challenge, a decline and a challenge with a bad room id',
    should: 'pass the first two on and refuse the third before any change',
    actual: [responses.map((response) => response.status), calls],
    expected: [
      [200, 200, 400],
      [
        ['challenge', 'bea', room],
        ['decline', 'cat', room],
      ],
    ],
  });
});
