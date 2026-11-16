import { assert, setupRitewayBun, test } from 'riteway/bun';
import { resolveLobbyGrantTarget } from './lobby-grant-target';
import type { TabPrincipal } from './tab-principal';

setupRitewayBun();
const principal: TabPrincipal = {
  kind: 'user',
  userId: 'u'.repeat(24),
  actorId: 'a'.repeat(24),
};
const lobbyId = 'l'.repeat(24);
const input = { lobbyId, expectedVersion: 3, username: ' New_Official ' };
const people = { lobbyId, version: 3, capabilities: { give: true } };

test('lobby grant discovery follows current authority and the expected lobby version', async () => {
  const calls: string[] = [];
  const target = 't'.repeat(24);
  const userId = await resolveLobbyGrantTarget(principal, input, {
    readPeople: async (viewer, lobby) => {
      calls.push(`read:${viewer.userId}:${lobby}`);
      return people;
    },
    discover: async (actor, username) => {
      calls.push(`discover:${actor}:${username}`);
      return target;
    },
    userIdOfActor: async (actor) => {
      calls.push(`user:${actor}`);
      return 'r'.repeat(24);
    },
  });
  assert({
    given:
      'an authorized lobby manager naming a person without organization membership',
    should:
      'canonicalize the username and use budgeted discovery before resolving its internal user binding',
    actual: [userId, calls],
    expected: [
      'r'.repeat(24),
      [
        `read:${principal.userId}:${lobbyId}`,
        `discover:${principal.actorId}:new_official`,
        `user:${target}`,
      ],
    ],
  });
});

test('refused and stale people reads never probe a username', async () => {
  const attempts = [];
  let probes = 0;
  for (const read of [
    null,
    { ...people, version: 4 },
    { ...people, capabilities: { give: false } },
  ]) {
    attempts.push(
      await resolveLobbyGrantTarget(principal, input, {
        readPeople: async () => read,
        discover: async () => {
          probes += 1;
          return 't'.repeat(24);
        },
        userIdOfActor: async () => 'r'.repeat(24),
      }),
    );
  }
  assert({
    given: 'missing access, a moved lobby guard, or no give capability',
    should:
      'refuse every request before discovery spends a unit or probes an account',
    actual: [attempts, probes],
    expected: [[null, null, null], 0],
  });
});

test('invalid usernames and unknown or retired accounts cannot become grant targets', async () => {
  const discovered: string[] = [];
  let bindings = 0;
  const dependencies = {
    readPeople: async () => people,
    discover: async (_actor: string, username: string) => {
      discovered.push(username);
      return username === 'absent' ? null : 't'.repeat(24);
    },
    userIdOfActor: async () => {
      bindings += 1;
      return null;
    },
  };
  const outcomes = [];
  for (const username of ['Kelvin', 'absent', 'retired'])
    outcomes.push(
      await resolveLobbyGrantTarget(
        principal,
        { ...input, username },
        dependencies,
      ),
    );
  assert({
    given:
      'a non-ASCII username, no public identity, and an actor whose human account is no longer active',
    should:
      'return no internal grant target without probing invalid input or looking up an absent actor',
    actual: [outcomes, discovered, bindings],
    expected: [[null, null, null], ['absent', 'retired'], 1],
  });
});
