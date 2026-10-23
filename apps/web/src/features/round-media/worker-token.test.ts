import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { createRoundMediaOperations } from './operations';
import { createMediaWorkerTokenBroker } from './worker-token';
import { createMediaWorld, fixedId } from './media-world.test-support';
setupRitewayBun();

type Broker = Parameters<typeof createMediaWorkerTokenBroker>[0];
const workerId = fixedId('worker');
const broker = (
  world: ReturnType<typeof createMediaWorld>,
  leased: () => boolean = () => true,
) => {
  const verified: string[] = [];
  const capture = {
    verifyMediaWorkerLease: async (scope: { workerId: string }) => {
      verified.push(scope.workerId);
      if (!leased()) throw createAppError('CONFLICT', 'Lease lost');
      return { serverNow: '2026-10-22T00:00:00.000Z' };
    },
  } as unknown as Broker['capture'];
  return {
    verified,
    tokens: createMediaWorkerTokenBroker({
      sessions: world.input.store,
      capture,
      media: world.input.media,
      workerUrl: world.input.workerUrl,
      nextId: world.input.nextId,
      deadline: world.input.deadline,
    }),
  };
};
const scope = (world: ReturnType<typeof createMediaWorld>) => ({
  roundId: world.roundId,
  sessionId: fixedId('session'),
  workerId,
  epoch: 1,
});
const authenticated = (world: ReturnType<typeof createMediaWorld>) =>
  ({
    roundId: world.roundId,
    workerId,
    serviceId: `media-capture:${workerId}`,
  }) as Parameters<
    ReturnType<typeof createMediaWorkerTokenBroker>['captureToken']
  >[1];
const claims = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
    video: Record<string, unknown>;
  };

test('a leased capture worker receives a hidden receive-only token for the existing room', async () => {
  const world = createMediaWorld();
  await createRoundMediaOperations(world.input).session(
    world.roundId,
    world.seats[0].actorId,
  );
  const { tokens, verified } = broker(world);
  const minted = await tokens.captureToken(scope(world), authenticated(world));
  assert({
    given: 'a signed worker whose lease is verified before and after the read',
    should:
      'mint a hidden subscribe-only token on the worker URL with a 60 s expiry',
    actual: [
      verified.length,
      minted.url,
      minted.roomName,
      minted.expiresAt,
      claims(minted.token).video.hidden,
      claims(minted.token).video.canPublish,
      claims(minted.token).video.canSubscribe,
    ],
    expected: [
      2,
      'ws://worker.daisy.invalid',
      world.roomName,
      '2026-10-22T00:01:00.000Z',
      true,
      false,
      true,
    ],
  });
});

test('a capture worker never creates a missing room', async () => {
  const world = createMediaWorld();
  const { tokens } = broker(world);
  await assertRejects({
    given: 'a leased worker before any human admission created the room',
    should: 'refuse as unavailable infrastructure without a vendor write',
    code: 'INFRASTRUCTURE',
    actual: () => tokens.captureToken(scope(world), authenticated(world)),
  });
  assert({
    given: 'the refusal',
    should: 'leave the vendor untouched',
    actual: world.journal,
    expected: [],
  });
});

test('a signed identity for another Round, worker or service is refused before the lease read', async () => {
  const world = createMediaWorld();
  const { tokens, verified } = broker(world);
  for (const mismatch of [
    { roundId: fixedId('other') },
    { workerId: fixedId('otherworker') },
    { serviceId: 'media-capture:someone-else' },
  ])
    await assertRejects({
      given: `a worker signature with a mismatched ${Object.keys(mismatch)[0]}`,
      should: 'refuse authorization',
      code: 'AUTHORIZATION',
      actual: () =>
        tokens.captureToken(scope(world), {
          ...authenticated(world),
          ...mismatch,
        }),
    });
  assert({
    given: 'the three refusals',
    should: 'never read the worker lease',
    actual: verified,
    expected: [],
  });
});

test('a lost lease or foreign session is refused', async () => {
  const world = createMediaWorld();
  await createRoundMediaOperations(world.input).session(
    world.roundId,
    world.seats[0].actorId,
  );
  await assertRejects({
    given: 'a worker whose lease is no longer current',
    should: 'refuse with the lease conflict',
    code: 'CONFLICT',
    actual: () =>
      broker(world, () => false).tokens.captureToken(
        scope(world),
        authenticated(world),
      ),
  });
  await assertRejects({
    given: 'a lease scoped to a different media session',
    should: 'refuse as not found',
    code: 'NOT_FOUND',
    actual: () =>
      broker(world).tokens.captureToken(
        { ...scope(world), sessionId: fixedId('othersession') },
        authenticated(world),
      ),
  });
});

/** The world as a browser reconcile holding its session would show it. */
const reconciling = (world: ReturnType<typeof createMediaWorld>) => {
  const reading = world.input.store.readMediaSession;
  return {
    ...world,
    input: {
      ...world.input,
      store: {
        ...world.input.store,
        readMediaSession: (async (request: Parameters<typeof reading>[0]) => {
          const state = await reading(request);
          return (
            state && {
              ...state,
              session: {
                ...state.session,
                reconcileOwner: fixedId('reconciler'),
              },
            }
          );
        }) as typeof reading,
      },
    },
  } as typeof world;
};

test('a capture token requested during a browser reconcile is refused for now, not in conflict', async () => {
  const world = createMediaWorld();
  await createRoundMediaOperations(world.input).session(
    world.roundId,
    world.seats[0].actorId,
  );
  const { tokens } = broker(reconciling(world));
  await assertRejects({
    given:
      "a leased worker asking for its token while a browser's reconcile holds a live session",
    should:
      'refuse as temporarily unavailable, which the worker retries, never as a definite conflict that ends its epoch (ISSUE-494)',
    code: 'INFRASTRUCTURE',
    actual: () => tokens.captureToken(scope(world), authenticated(world)),
  });
});

test("a terminal Round's capture token is refused for good, whoever holds the session", async () => {
  const world = createMediaWorld();
  await createRoundMediaOperations(world.input).session(
    world.roundId,
    world.seats[0].actorId,
  );
  world.end();
  const { tokens } = broker(reconciling(world));
  const refused = await tokens
    .captureToken(scope(world), authenticated(world))
    .then(
      () => null,
      (error: { code: string; message: string }) => [error.code, error.message],
    );
  assert({
    given:
      "a completed Round whose terminal reconcile holds the session, and its worker's token request",
    should:
      'refuse definitely as an ended capture session, so the worker stops instead of retrying (ISSUE-494)',
    actual: refused,
    expected: ['CONFLICT', 'Capture session has ended'],
  });
});
