import { assert, setupRitewayBun, test } from 'riteway/bun';
import { observeFloor } from './floor-telemetry';
import type { MediaOperationInput } from './operation-context';

setupRitewayBun();

const at = (ms: number) => new Date(ms).toISOString();
const fence = { sessionId: 's', owner: 'owner', epoch: 1 };
const round = {
  startedAt: at(0),
  rules: { countdownMs: 1_000, segments: [{}, {}] },
  checkpoint: null,
  segments: [
    {
      startedAt: at(1_000),
      endedAt: at(4_000),
      durationMs: 60_000,
    },
  ],
};

/** A pass's collaborators, each advancing the clock as a slow call would. */
const world = () => {
  let now = 5_000;
  const lines: { event: string; fields: Record<string, unknown> }[] = [];
  const input = {
    now: () => now,
    logger: {
      log: (event: string, fields: Record<string, unknown>) =>
        lines.push({ event, fields }),
    },
    store: {
      claimMediaReconcile: async () => ({
        kind: 'claimed',
        roundId: 'round',
        roomName: 'room',
        fence,
      }),
      beginMediaMutation: async (begin: {
        authorize: (context: unknown) => void;
      }) => {
        begin.authorize({ round, now: at(now) });
        return { id: 'mutation' };
      },
      finishMediaReconcile: async () => {
        now += 10;
        return { retired: null };
      },
    },
    media: {
      exists: async () => {
        now += 20;
        return true;
      },
      publicationPermissions: async () => {
        now += 30;
        return [
          { identity: 'a', grants: { publish: ['microphone'] } },
          { identity: 'b', grants: { publish: ['camera'] } },
        ];
      },
      permissions: async () => {
        now += 40;
      },
      joinToken: async () => 'token',
    },
  } as unknown as MediaOperationInput;
  return { input, lines, later: (ms: number) => (now += ms) };
};
const permissions = (publish: string[]) => ({
  publish,
  subscribe: true,
  hidden: false,
  capture: false,
});
const claimed = async (observed: MediaOperationInput) =>
  observed.store.claimMediaReconcile({
    sessionId: 's',
    owner: 'owner',
  } as never);

test('a pass reports what it spent, and the floor it moved with its mover', async () => {
  const { input, lines } = world();
  const floor = observeFloor(input);
  const observed = floor.input;
  await floor.asMover('tick', async () => {
    await claimed(observed);
    await observed.media.exists('room');
    await observed.media.publicationPermissions('room');
    await observed.store.beginMediaMutation({
      ...fence,
      authorize: () => undefined,
    } as never);
    await observed.media.permissions(
      'room',
      'a',
      permissions(['camera']) as never,
    );
    await observed.store.finishMediaReconcile({ ...fence } as never);
  });
  assert({
    given: 'a tick pass that closed a microphone',
    should: 'log the floor move and then the pass, with no personal data',
    actual: lines,
    expected: [
      {
        event: 'round.media.floor_moved',
        fields: {
          roundId: 'round',
          mover: 'tick',
          dueAtMs: 5_000,
          appliedAtMs: 5_090,
        },
      },
      {
        event: 'round.media.pass',
        fields: {
          roundId: 'round',
          mover: 'tick',
          durationMs: 100,
          vendorCalls: 3,
          vendorMs: 90,
          permissionWrites: 1,
          vendorCallsOutsidePasses: 0,
        },
      },
    ],
  });
});

test('a write that leaves the microphone alone is not a floor move', async () => {
  const { input, lines } = world();
  const { input: observed } = observeFloor(input);
  await claimed(observed);
  await observed.media.publicationPermissions('room');
  await observed.store.beginMediaMutation({
    ...fence,
    authorize: () => undefined,
  } as never);
  await observed.media.permissions(
    'room',
    'b',
    permissions(['camera', 'screen_share']) as never,
  );
  await observed.store.finishMediaReconcile({ ...fence } as never);
  assert({
    given: 'a seat whose other sources changed',
    should: 'log only the pass, by a browser since no other mover said so',
    actual: lines.map(({ event, fields }) => [event, fields.mover]),
    expected: [['round.media.pass', 'browser']],
  });
});

test('a vendor write that fails moves no floor', async () => {
  const { input, lines } = world();
  (input.media as { permissions: unknown }).permissions = async () => {
    throw Error('unavailable');
  };
  const { input: observed } = observeFloor(input);
  await claimed(observed);
  await observed.media.publicationPermissions('room');
  await observed.store.beginMediaMutation({
    ...fence,
    authorize: () => undefined,
  } as never);
  const refused = await observed.media
    .permissions('room', 'a', permissions([]) as never)
    .then(
      () => 'resolved',
      (error: Error) => error.message,
    );
  await observed.store.finishMediaReconcile({ ...fence } as never);
  assert({
    given: 'LiveKit refusing the write',
    should: 'pass the refusal on, count the call and log no floor move',
    actual: [
      refused,
      lines.map(({ event }) => event),
      lines[0]?.fields.vendorCalls,
    ],
    expected: ['unavailable', ['round.media.pass'], 2],
  });
});

test('vendor calls outside any pass reach the next pass this process logs', async () => {
  const { input, lines } = world();
  const { input: observed } = observeFloor(input);
  await observed.media.exists('room');
  await observed.media.exists('room');
  await claimed(observed);
  await observed.store.finishMediaReconcile({ ...fence } as never);
  await claimed(observed);
  await observed.store.finishMediaReconcile({ ...fence } as never);
  assert({
    given: 'two reads of a room with no pass running, then two passes',
    should: 'count them once, on the first pass',
    actual: lines.map(({ fields }) => fields.vendorCallsOutsidePasses),
    expected: [2, 0],
  });
});

test('a pass whose finish fails still logs and leaves nothing open', async () => {
  const { input, lines } = world();
  (input.store as { finishMediaReconcile: unknown }).finishMediaReconcile =
    async () => {
      throw Error('connection lost');
    };
  const { input: observed } = observeFloor(input);
  await claimed(observed);
  const refused = await observed.store
    .finishMediaReconcile({ ...fence } as never)
    .catch((error: Error) => error.message);
  await observed.media.exists('room');
  await claimed(observed);
  assert({
    given: 'a finish that fails, then a later room read',
    should: 'log the pass and count the read as outside any pass',
    actual: [refused, lines.length],
    expected: ['connection lost', 1],
  });
});
