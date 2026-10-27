import { createAppError } from '@daisy/errors';
import { createMediaWorkerClient } from '@daisy/media/worker';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { captureConnectionClosed } from '@daisy/media/capture';
import { captureFailureExit, describeCaptureExit } from './capture-exit';
import type { CaptureClient } from './capture-history';
import { runCaptureSession } from './capture-session';

export const captureRoundId = 'r'.repeat(24);

const state = {
  roundId: captureRoundId,
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
    roundId: captureRoundId,
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
 * once the room drops. `read` replaces the canned history answer outright
 * ('closed' answers with the server's capture-closed refusal) and
 * `onSubscribe` runs while the room connection is being made.
 */
export function createCaptureSessionFixture(
  options: {
    readonly lease?: CaptureClient['lease'];
    readonly waitUntilMs?: (due: number, signal: AbortSignal) => Promise<void>;
    readonly drop?: number;
    readonly closedOnDrop?: boolean;
    readonly consumerFails?: number;
    readonly closeThrows?: boolean;
    /** How long each history read takes. */
    readonly readMs?: number;
    /** The first refresh lasts until its own history deadline aborts it. */
    readonly stallRefresh?: boolean;
    /** Stop only once the fresh retry has been consumed by the live loop. */
    readonly closeAfterRecovery?: boolean;
    /** Replaces the canned history answer for every read. */
    readonly read?: (request: {
      epoch: number;
      segmentId?: string;
    }) => Awaited<ReturnType<CaptureClient['read']>> | 'closed';
    /** Runs with the room's frame emitter once the subscription is set up. */
    readonly onSubscribe?: (
      emit: (frame: {
        identity: string;
        trackId: string;
        sequence: number;
        beforeMs: number;
        afterMs: number;
        pcm: Int16Array;
      }) => void,
    ) => void;
    /**
     * LiveKit's disconnect has closed the connection, so identity updates
     * refuse, before `closed` resolves (native cleanup still running).
     */
    readonly closingFirst?: boolean;
  } = {},
) {
  const closed = Promise.withResolvers<'disconnected' | 'closed'>();
  let dropped = false;
  if (options.drop !== undefined)
    setTimeout(() => {
      dropped = true;
      if (!options.closingFirst) closed.resolve('disconnected');
    }, options.drop);
  let reads = 0;
  const seals: number[] = [];
  const client = {
    lease: options.lease ?? (async () => ({ epoch: 1 })),
    token: async () => ({ url: 'wss://media.invalid', token: 'token' }),
    read: (
      request: { epoch: number; segmentId?: string },
      signal?: AbortSignal,
    ) =>
      options.read === undefined && dropped && options.closedOnDrop
        ? closedForGood.read(request, signal)
        : (() => {
            reads++;
            if (options.stallRefresh && reads === 2)
              return new Promise<Awaited<ReturnType<CaptureClient['read']>>>(
                (_resolve, reject) => {
                  signal?.addEventListener(
                    'abort',
                    () =>
                      reject(
                        createAppError(
                          'CONFLICT',
                          'Media control was cancelled',
                        ),
                      ),
                    { once: true },
                  );
                },
              );
            if (options.closeAfterRecovery && reads === 4)
              return closedForGood.read(request, signal);
            const answered = options.read
              ? options.read(request)
              : { state, calibration };
            return answered === 'closed'
              ? closedForGood.read(request, signal)
              : answer(answered, options.readMs ?? 2, signal);
          })(),
    seal: async () => {
      seals.push(reads);
      return {};
    },
    heard: async () => undefined,
    activity: async () => undefined,
  } as unknown as CaptureClient;
  const done = runCaptureSession(
    {
      roundId: captureRoundId,
      client,
      voice: { transcribe: async () => '' } as never,
      sttModel: 'model',
      nowMs: performance.now,
      waitUntilMs:
        options.waitUntilMs ??
        ((due, signal) =>
          new Promise((resolve) => {
            const timer = setTimeout(
              resolve,
              Math.max(1, due - performance.now()),
            );
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              resolve();
            });
          })),
      subscribe: (async (setup: { onFrame: (frame: never) => void }) => {
        options.onSubscribe?.((frame) => setup.onFrame(frame as never));
        return {
          closed: closed.promise,
          setIdentities: async () => {
            if (dropped && options.closingFirst)
              throw captureConnectionClosed();
          },
          close: async () => {
            closed.resolve('closed');
            if (options.closeThrows) throw new Error('native close failed');
          },
        };
      }) as never,
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
  return {
    done,
    /** History reads answered so far, and the read count at each seal. */
    reads: () => reads,
    seals: () => seals,
  };
}
