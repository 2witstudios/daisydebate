import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { createMediaWorkerClient } from '@daisy/media/worker';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { captureFailureExit, describeCaptureExit } from './capture-exit';
import type { CaptureClient } from './capture-history';
import { runCaptureSession } from './capture-session';
setupRitewayBun();

const ROUND = 'r'.repeat(24);

const state = {
  roundId: ROUND,
  version: 1,
  serverNow: new Date(0).toISOString(),
  status: 'active',
  transcriptAdmissionCutoff: null,
  participants: [],
  segment: null,
  intervals: [],
  nextIntervalId: null,
};
const calibration = {
  sentAtMs: 0,
  receivedAtMs: 0,
  serverNowMs: 0,
  precisionMs: 1,
};
/** Like the real client, an in-flight call refuses with CONFLICT once its caller aborts. */
const answer = <T>(value: T, ms: number, signal?: AbortSignal) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(value), ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(createAppError('CONFLICT', 'Media control was cancelled'));
    });
  });
/** The server's answer once a Round's capture is closed for good. */
const closedForGood = createMediaWorkerClient({
  scope: {
    roundId: ROUND,
    sessionId: 's'.repeat(24),
    workerId: 'w'.repeat(24),
  },
  url: 'http://127.0.0.1/',
  authentication: createMediaWorkerAuthentication({
    secret: Buffer.alloc(32, 6).toString('base64url'),
    now: () => 1000,
  }),
  fetch: async () =>
    new Response(JSON.stringify({ refusal: 'capture-closed' }), {
      status: 409,
    }),
  nowMs: performance.now,
  deadlineSignal: () => AbortSignal.timeout(2000),
});

/**
 * A session joined to a fake LiveKit room that the test may drop, with a
 * clip consumer the test may fail, and a server that may close the capture
 * once the room drops.
 */
function harness(
  options: {
    readonly drop?: number;
    readonly closedOnDrop?: boolean;
    readonly consumerFails?: number;
    readonly closeThrows?: boolean;
    /** How long each history read takes. */
    readonly readMs?: number;
  } = {},
) {
  const closed = Promise.withResolvers<'disconnected' | 'closed'>();
  let dropped = false;
  if (options.drop !== undefined)
    setTimeout(() => {
      dropped = true;
      closed.resolve('disconnected');
    }, options.drop);
  const client = {
    lease: async () => ({ epoch: 1 }),
    token: async () => ({ url: 'wss://media.invalid', token: 'token' }),
    read: (request: { epoch: number }, signal?: AbortSignal) =>
      dropped && options.closedOnDrop
        ? closedForGood.read(request, signal)
        : answer({ state, calibration }, options.readMs ?? 2, signal),
    seal: async () => ({}),
    heard: async () => undefined,
    activity: async () => undefined,
  } as unknown as CaptureClient;
  return runCaptureSession(
    {
      roundId: ROUND,
      client,
      voice: { transcribe: async () => '' } as never,
      sttModel: 'model',
      nowMs: performance.now,
      waitUntilMs: (due, signal) =>
        new Promise((resolve) => {
          const timer = setTimeout(
            resolve,
            Math.max(1, due - performance.now()),
          );
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
          });
        }),
      subscribe: (async () => ({
        closed: closed.promise,
        setIdentities: async () => undefined,
        close: async () => {
          closed.resolve('closed');
          if (options.closeThrows) throw new Error('native close failed');
        },
      })) as never,
      consume: async ({ signal }) => {
        if (options.consumerFails === undefined)
          return new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => resolve()),
          );
        await new Promise((resolve) =>
          setTimeout(resolve, options.consumerFails),
        );
        throw createAppError('INFRASTRUCTURE', 'append outlasted its retries');
      },
    },
    new AbortController().signal,
  ).then(
    (ended) => (ended.closed ? 'closed for good' : 'ended cleanly'),
    (error: unknown) => describeCaptureExit(captureFailureExit(error)),
  );
}

test('a failure is reported where it began, not where the session it stopped was waiting', async () => {
  assert({
    given:
      'the clip consumer failing while the batch loop has a history read in flight',
    should:
      'report the transcription stage, not the cancelled read it aborted (ISSUE-571 review)',
    actual: await harness({ consumerFails: 20, readMs: 50 }),
    expected: { cause: 'transcription', errorCode: 'INFRASTRUCTURE' },
  });
  assert({
    given: 'that failure, then a shutdown step that throws',
    should: 'still report the first failure',
    actual: await harness({ consumerFails: 20, readMs: 50, closeThrows: true }),
    expected: { cause: 'transcription', errorCode: 'INFRASTRUCTURE' },
  });
});

test('a LiveKit room that drops after connect is a connect failure, unless the Round closed', async () => {
  assert({
    given: 'the LiveKit room dropping while the Round still needs capture',
    should: 'report the connect stage rather than end cleanly',
    actual: await harness({ drop: 10 }),
    expected: { cause: 'connect', errorCode: 'INFRASTRUCTURE' },
  });
  assert({
    given:
      'the LiveKit room dropping because the server closed the capture for good',
    should: 'finish the session, as a terminal Round does',
    actual: await harness({ drop: 10, closedOnDrop: true }),
    expected: 'closed for good',
  });
});
