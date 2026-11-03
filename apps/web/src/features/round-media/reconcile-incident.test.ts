import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundMediaOperations } from './operations';
import { createMediaWorld } from './media-world.test-support';
import type { RoundIncidentEvidence } from '../round-incidents/observe';
setupRitewayBun();

/** A live Round with an admitted seat, and every pass's evidence recorded. */
const live = async () => {
  const world = createMediaWorld({ status: 'active' });
  const seen: RoundIncidentEvidence[] = [];
  const operations = createRoundMediaOperations({
    ...world.input,
    observeIncident: async (evidence) => {
      seen.push(evidence);
    },
  });
  await operations.session(world.roundId, world.seats[0].actorId);
  seen.length = 0;
  return { world, operations, seen };
};

test('a pass tells the incident hook what it read of the room', async () => {
  const { world, operations, seen } = await live();
  world.connect(world.seats[0].id, {
    publish: [],
    subscribe: true,
    hidden: false,
  });
  await operations.reconcile(world.roundId);
  assert({
    given: 'a pass that listed one seat and no capture agent',
    should: 'report the room as read, with no retirement',
    actual: seen.map(({ observation, roomRetired }) => ({
      observation,
      roomRetired,
    })),
    expected: [
      {
        observation: {
          kind: 'room',
          empty: false,
          captureListed: false,
          seatsListed: false,
          speakerHeard: null,
        },
        roomRetired: false,
      },
    ],
  });
});

test('a pass that cannot reach the vendor says so, and still fails as before', async () => {
  const { world, operations, seen } = await live();
  world.fail('listRooms');
  const failed = await operations.reconcile(world.roundId).then(
    () => false,
    () => true,
  );
  assert({
    given: 'a vendor read that fails',
    should: 'report unreachable and keep the failure for the caller',
    actual: { failed, observation: seen.at(-1)?.observation },
    expected: { failed: true, observation: { kind: 'unreachable' } },
  });
});

test('a pass refused before reading the vendor claims nothing about it', async () => {
  const { world, operations, seen } = await live();
  world.revoke(world.seats[0].id);
  await operations
    .session(world.roundId, world.seats[0].actorId)
    .catch(() => undefined);
  assert({
    given: 'a refused admission',
    should: 'never report the vendor unreachable',
    actual: seen.some(({ observation }) => observation.kind === 'unreachable'),
    expected: false,
  });
});
