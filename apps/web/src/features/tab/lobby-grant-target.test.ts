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
// A caller may retain the writer's original guard beside the lookup fields.
const input = { lobbyId, expectedVersion: 3, username: ' New_Official ' };
const people = { lobbyId, version: 3, capabilities: { give: true } };

test('lobby grant discovery follows current authority', async () => {
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
      calls.push(`binding:${actor}`);
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
        `binding:${target}`,
      ],
    ],
  });
});

test('refused people reads never probe a username', async () => {
  const attempts = [];
  let probes = 0;
  for (const read of [null, { ...people, capabilities: { give: false } }]) {
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
    given: 'missing access or no give capability',
    should:
      'refuse every request before discovery spends a unit or probes an account',
    actual: [attempts, probes],
    expected: [[null, null], 0],
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

test('username resolution remains available after a successful grant moves the lobby version', async () => {
  let version = 3;
  let probes = 0;
  const target = 'r'.repeat(24);
  const dependencies = {
    readPeople: async () => ({ ...people, version }),
    discover: async () => {
      probes += 1;
      return 't'.repeat(24);
    },
    userIdOfActor: async () => target,
  };
  const first = await resolveLobbyGrantTarget(principal, input, dependencies);
  version = 4;
  const retry = await resolveLobbyGrantTarget(principal, input, dependencies);
  assert({
    given:
      'the same authorized People scope after a successful grant increments its version',
    should:
      'resolve the same username so the unchanged command can reach its durable replay receipt',
    actual: [first, retry, probes],
    expected: [target, target, 2],
  });
});
