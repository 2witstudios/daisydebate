import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundMediaOperations } from './operations';
import { createMediaWorld } from './media-world.test-support';
setupRitewayBun();

test('a revoked human already in the room is demoted by the next reconcile; the opponent is untouched (ISSUE-714)', async () => {
  const world = createMediaWorld();
  const operations = createRoundMediaOperations(world.input);
  const [affirmative, negative] = world.seats;
  // Both join with the grants their admission minted.
  for (const seat of [affirmative, negative]) {
    const { grants } = await operations.session(world.roundId, seat.actorId);
    world.connect(seat.id, { ...grants, publish: [...grants.publish] });
  }
  const opponentBefore = world.connected.get(world.identity(negative.id));
  world.journal.length = 0;
  // The operator revokes the affirmative's beta access mid-Round.
  world.withdraw(affirmative.id);
  await operations.recoverActiveSessions();
  const demoted = world.connected.get(world.identity(affirmative.id));
  const writes = world.journal.filter((entry) => !entry.startsWith('exists'));
  world.journal.length = 0;
  await operations.recoverActiveSessions();
  assert({
    given:
      'both debaters publishing, then the affirmative revoked while the opponent keeps access',
    should:
      'strip every grant from the revoked identity on the next recovery pass, keep the room and the opponent as they were, and converge',
    actual: {
      demoted,
      writes,
      roomKept: world.rooms.has(world.roomName),
      opponent: world.connected.get(world.identity(negative.id)),
      converged: world.journal.filter((entry) =>
        entry.startsWith('permissions'),
      ),
    },
    expected: {
      demoted: { publish: [], subscribe: false, hidden: false },
      writes: [`permissions:${world.identity(affirmative.id)}:-`],
      roomKept: true,
      opponent: opponentBefore,
      converged: [],
    },
  });
});

test('a revoked human cannot mint a fresh media token (ISSUE-693, ISSUE-714)', async () => {
  const world = createMediaWorld();
  const operations = createRoundMediaOperations(world.input);
  const [affirmative] = world.seats;
  world.withdraw(affirmative.id);
  const outcome = await operations
    .session(world.roundId, affirmative.actorId)
    .then(
      () => 'issued',
      (error: { code?: string }) => error.code,
    );
  assert({
    given: 'a human whose beta access was revoked',
    should: 'be refused a token',
    actual: outcome,
    expected: 'AUTHORIZATION',
  });
});
