import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError, isAppError } from '@daisy/errors';
import { createMediaWorkerClient } from '@daisy/media/worker';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { createRoundMediaOperations } from '../apps/web/src/features/round-media/operations';
import {
  createMediaWorld,
  fixedId,
} from '../apps/web/src/features/round-media/media-world.test-support';
import {
  broker,
  authenticated,
  scope,
} from '../apps/web/src/features/round-media/worker-token.test-support';
import { issueCaptureToken } from '../apps/media-worker/src/capture-token';
import {
  captureFailureExit,
  describeCaptureExit,
} from '../apps/media-worker/src/capture-exit';
import {
  CAPTURE_FINISHED_EXIT,
  createCaptureSupervisor,
} from '../apps/media-worker/src/supervisor';

setupRitewayBun();
test('capture token admission under continuous recovery does not produce the four503 relaunch cycle (ISSUE-521)', async () => {
  const world = createMediaWorld();
  await createRoundMediaOperations(world.input).session(
    world.roundId,
    world.seats[0].actorId,
  );
  world.holdClaims(10000);
  let waits = 0;
  const wait = async () => {
    if (++waits % 4 === 0)
      throw createAppError('INFRASTRUCTURE', 'Media recovery is unresolved');
  };
  const { tokens } = broker({ ...world, input: { ...world.input, wait } });
  const { epoch, ...workerScope } = scope(world);
  let now = 0,
    launches = 0,
    refusals = 0;
  const failed: ReturnType<typeof describeCaptureExit>[] = [];
  let settled: Promise<unknown> = Promise.resolve();
  const supervisor = createCaptureSupervisor({
    maxSessions: 1,
    retryMs: { initial: 1000, max: 30000 },
    nowMs: () => now,
    nextWorkerId: () => fixedId('worker'),
    discover: async () => [
      { roundId: world.roundId, sessionId: scope(world).sessionId },
    ],
    launch: () => {
      launches++;
      const client = createMediaWorkerClient({
        scope: workerScope,
        url: 'http://127.0.0.1',
        authentication: createMediaWorkerAuthentication({
          secret: Buffer.alloc(32, 6).toString('base64url'),
          now: () => 1000,
        }),
        unavailableRetryMs: [0, 0, 0],
        nowMs: () => now,
        deadlineSignal: () => new AbortController().signal,
        fetch: async (url) => {
          if (url.endsWith('/lease'))
            return Response.json({
              epoch: 1,
              expiresAt: new Date(15000).toISOString(),
            });
          try {
            return Response.json(
              await tokens.captureToken(scope(world), authenticated(world)),
            );
          } catch (error) {
            refusals++;
            return Response.json(
              { error: { code: isAppError(error) ? error.code : 'INTERNAL' } },
              { status: 503 },
            );
          }
        },
      });
      const exited = issueCaptureToken(
        client,
        epoch,
        new AbortController().signal,
      ).then(
        () => CAPTURE_FINISHED_EXIT,
        (error: unknown) => captureFailureExit(error),
      );
      settled = exited;
      return { exited, stop: () => undefined };
    },
    failed: (status) => {
      failed.push(describeCaptureExit(status));
    },
  });
  for (let tick = 0; tick < 5; tick++) {
    await supervisor.tick();
    await settled;
    now += 32000;
  }
  await supervisor.stop();
  assert({
    given:
      'a live safe room whose recovery keeps winning reconcile claims, through actual token HTTP retries and the supervisor',
    should:
      'issue on its receive-only fast path once, then honor terminal capture completion without503s, failures or32s relaunches',
    actual: { launches, refusals, failed, waits },
    expected: { launches: 1, refusals: 0, failed: [], waits: 0 },
  });
});
