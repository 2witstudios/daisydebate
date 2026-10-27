import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError, isAppError } from '@daisy/errors';
import { createMediaWorkerClient } from '@daisy/media/worker';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { namedCaptureRefusal } from '../apps/web/src/features/media-capture/handlers';
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
  startRefusalExit,
  tagCaptureFailure,
} from '../apps/media-worker/src/capture-exit';
import {
  CAPTURE_FINISHED_EXIT,
  createCaptureSupervisor,
} from '../apps/media-worker/src/supervisor';

setupRitewayBun();

/**
 * The actual capture startup chain: supervisor → worker token HTTP retries →
 * signed token broker → media operations, on an injected clock. Each launch
 * exits as `capture-run` would: finished for a closed capture, else the
 * stage-coded failure.
 */
function superviseCapture(
  world: ReturnType<typeof createMediaWorld>,
  wait?: () => Promise<void>,
) {
  const { tokens } = broker(
    wait ? { ...world, input: { ...world.input, wait } } : world,
  );
  const { epoch, ...workerScope } = scope(world);
  const run = { now: 0, launches: [] as number[], refusals: 0 };
  const failed: ReturnType<typeof describeCaptureExit>[] = [];
  let settled: Promise<unknown> = Promise.resolve();
  const supervisor = createCaptureSupervisor({
    maxSessions: 1,
    retryMs: { initial: 1000, max: 30000 },
    nowMs: () => run.now,
    nextWorkerId: () => fixedId('worker'),
    discover: async () => [
      { roundId: world.roundId, sessionId: scope(world).sessionId },
    ],
    launch: () => {
      run.launches.push(run.now);
      const client = createMediaWorkerClient({
        scope: workerScope,
        url: 'http://127.0.0.1',
        authentication: createMediaWorkerAuthentication({
          secret: Buffer.alloc(32, 6).toString('base64url'),
          now: () => 1000,
        }),
        unavailableRetryMs: [0, 0, 0],
        nowMs: () => run.now,
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
            run.refusals++;
            // The route's own named refusals; every other failure here is a 503.
            return (
              namedCaptureRefusal(error, 'request') ??
              Response.json(
                {
                  error: { code: isAppError(error) ? error.code : 'INTERNAL' },
                },
                { status: 503 },
              )
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
        (error: unknown) => startRefusalExit(error),
      );
      settled = exited;
      return { exited, stop: () => undefined };
    },
    failed: (status) => {
      failed.push(describeCaptureExit(status));
    },
  });
  return {
    run,
    failed,
    /** One supervisor pass at `at` ms, settled. */
    tickAt: async (at: number) => {
      run.now = at;
      await supervisor.tick();
      await settled;
    },
    stop: () => supervisor.stop(),
  };
}

test('capture token admission under continuous recovery does not produce the four503 relaunch cycle (ISSUE-521)', async () => {
  const world = createMediaWorld();
  await createRoundMediaOperations(world.input).session(
    world.roundId,
    world.seats[0].actorId,
  );
  world.holdClaims(10000);
  let waits = 0;
  const capture = superviseCapture(world, async () => {
    if (++waits % 4 === 0)
      throw createAppError('INFRASTRUCTURE', 'Media recovery is unresolved');
  });
  for (let tick = 0; tick < 5; tick++) await capture.tickAt(tick * 32000);
  await capture.stop();
  assert({
    given:
      'a live safe room whose recovery keeps winning reconcile claims, through actual token HTTP retries and the supervisor',
    should:
      'issue on its receive-only fast path once, then honor terminal capture completion without503s, failures or32s relaunches',
    actual: {
      launches: capture.run.launches.length,
      refusals: capture.run.refusals,
      failed: capture.failed,
      waits,
    },
    expected: { launches: 1, refusals: 0, failed: [], waits: 0 },
  });
});

test('capture held behind unresolved recovery is classified, backs off, and finishes when the Round ends (ISSUE-521)', async () => {
  const world = createMediaWorld();
  await createRoundMediaOperations(world.input).session(
    world.roundId,
    world.seats[0].actorId,
  );
  // A vendor write whose outcome never settles: the session stays unresolved,
  // so every token takes the held path and recovery cannot clean it up.
  world.pend();
  const capture = superviseCapture(world);
  for (const at of [0, 500, 1000, 2000, 3000, 4000]) await capture.tickAt(at);
  const heldLaunches = [...capture.run.launches];
  world.end();
  await capture.tickAt(12000);
  await capture.tickAt(60000);
  await capture.stop();
  assert({
    given:
      'a session whose recovery stays unresolved, then a Round that completes, through actual token HTTP retries and the supervisor',
    should:
      'report each held launch as a token-stage INFRASTRUCTURE refusal, relaunch only on the backoff schedule, then finish once and never relaunch',
    actual: {
      heldLaunches,
      failed: capture.failed,
      launches: capture.run.launches,
    },
    expected: {
      heldLaunches: [0, 1000, 3000],
      failed: Array.from({ length: 3 }, () =>
        describeCaptureExit(
          captureFailureExit(
            tagCaptureFailure('token', createAppError('INFRASTRUCTURE')),
          ),
        ),
      ),
      launches: [0, 1000, 3000, 12000],
    },
  });
});
