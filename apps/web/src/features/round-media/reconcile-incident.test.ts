import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundMediaOperations } from './operations';
import { createMediaWorld } from './media-world.test-support';
import { OperationTimedOut } from '@daisy/observability';
import type { MediaOperationInput, MediaPassReport } from './operation-context';
setupRitewayBun();

/** A live Round with an admitted seat, and every pass's evidence recorded. */
const live = async () => {
  const world = createMediaWorld({ status: 'active' });
  const seen: MediaPassReport[] = [];
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
    actual: seen.map(({ observation, known }) => ({
      observation,
      roomRetired: known.roomRetired,
    })),
    expected: [
      {
        observation: {
          kind: 'room',
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

/** A pass with the vendor read overridden, and what it hands the store and the hook. */
const passWith = async (media: Partial<MediaOperationInput['media']>) => {
  const world = createMediaWorld({ status: 'active' });
  const seen: MediaPassReport[] = [];
  const finished: unknown[] = [];
  const vendor = { ...world.input.media };
  const input = {
    ...world.input,
    media: vendor,
    observeIncident: async (report: MediaPassReport) => void seen.push(report),
    store: {
      ...world.input.store,
      finishMediaReconcile: (request) => {
        finished.push(request.seen);
        return world.input.store.finishMediaReconcile(request);
      },
    } satisfies MediaOperationInput['store'],
  };
  const operations = createRoundMediaOperations(input);
  await operations.session(world.roundId, world.seats[0].actorId);
  Object.assign(vendor, media);
  await operations.reconcile(world.roundId);
  return { seen, finished };
};
const hiddenListener: Awaited<
  ReturnType<MediaOperationInput['media']['publicationPermissions']>
>[number] = {
  identity: 'listener',
  capture: false,
  microphoneTrack: null,
  grants: { publish: [], subscribe: true, hidden: true, capture: false },
  restricted: true,
};

test('a hidden listener is not capture', async () => {
  const listed = async (capture: boolean) => {
    const { seen } = await passWith({
      roomSid: async () => 'RM_room',
      publicationPermissions: async () => [{ ...hiddenListener, capture }],
    });
    const last = seen.at(-1)!.observation;
    return last.kind === 'room' && last.captureListed;
  };
  assert({
    given: 'a hidden unbound listener, and an agent',
    should: 'count only the agent as capture',
    actual: [await listed(false), await listed(true)],
    expected: [false, true],
  });
});

test('only the room node itself says it is gone', async () => {
  const answered = async (roomAnswers: () => Promise<boolean>) => {
    const { finished } = await passWith({
      someNodeDown: () => true,
      roomSid: async () => 'RM_room',
      publicationPermissions: async () => [hiddenListener],
      roomAnswers,
    });
    return (finished.at(-1) as { answered: boolean | null }).answered;
  };
  assert({
    given: 'an answer, the node refusing, a blip, and a call past its deadline',
    should: 'read true, false, unknown, and false',
    actual: [
      await answered(async () => true),
      await answered(async () => false),
      await answered(async () => {
        throw new Error('connection reset');
      }),
      await answered(async () => {
        throw new OperationTimedOut();
      }),
    ],
    expected: [true, false, null, false],
  });
});
