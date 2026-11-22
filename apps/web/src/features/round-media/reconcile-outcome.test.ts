import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundMediaOperations } from './operations';
import { createMediaWorld } from './media-world.test-support';
setupRitewayBun();

test('an unacknowledged permission pass still runs its callback and finishes before throwing that callback error', async () => {
  const world = createMediaWorld({ status: 'active' });
  const operations = createRoundMediaOperations(world.input);
  await operations.session(world.roundId, world.seats[0].actorId);
  world.connect(world.seats[1].id, {
    publish: [],
    subscribe: false,
    hidden: false,
  });
  world.fail('updateParticipant');
  const callback = Error('capture step failed');
  let calls = 0;
  const finished: boolean[] = [];
  const store = world.input.store;
  const watched = createRoundMediaOperations({
    ...world.input,
    store: {
      ...store,
      finishMediaReconcile: async (request) => {
        finished.push(request.clean);
        return store.finishMediaReconcile(request);
      },
    },
  });
  const error = await watched
    .holdForCapture(world.sessionId, async () => {
      calls += 1;
      throw callback;
    })
    .catch((error: unknown) => error);
  assert({
    given:
      'a permission write whose acknowledgement was lost and a failing held callback',
    should:
      'execute the callback once and finish unclean before returning its original error',
    actual: { calls, finished, original: error === callback },
    expected: { calls: 1, finished: [false], original: true },
  });
});

for (const escape of ['primary', 'finish', 'incident'] as const) {
  test(`${escape} failure preserves the public reconcile precedence`, async () => {
    const world = createMediaWorld({ status: 'active' });
    const primary = Error('primary');
    const closing = Error('closing');
    const finishing = Error('finish');
    const incident = Error('incident');
    let reads = 0;
    let finishes = 0;
    const store = world.input.store;
    const operations = createRoundMediaOperations({
      ...world.input,
      media: {
        ...world.input.media,
        roomSid: async () => {
          throw primary;
        },
      },
      store: {
        ...store,
        readMediaSession: async (request) => {
          if (escape !== 'incident') throw ++reads === 1 ? primary : closing;
          return store.readMediaSession(request);
        },
        finishMediaReconcile: async (request) => {
          finishes += 1;
          if (escape === 'finish') throw finishing;
          return store.finishMediaReconcile(request);
        },
      },
      observeIncident: async () => {
        throw incident;
      },
    });
    const error = await operations
      .holdForCapture(world.sessionId, async () => undefined)
      .catch((error: unknown) => error);
    assert({
      given: `${escape} fault while a media pass is finalizing`,
      should:
        'finish once and preserve original failure precedence without unsafe classification',
      actual: {
        expectedError:
          error ===
          (escape === 'primary'
            ? primary
            : escape === 'finish'
              ? finishing
              : incident),
        finishes,
        unsafe: world.state().unsafe,
      },
      expected: { expectedError: true, finishes: 1, unsafe: false },
    });
  });
}
