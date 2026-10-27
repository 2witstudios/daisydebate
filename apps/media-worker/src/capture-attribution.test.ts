import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { createMediaWorkerClient } from '@daisy/media/worker';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { captureConnectionClosed } from '@daisy/media/capture';
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
 * once the room drops. `read` replaces the canned history answer outright
 * ('closed' answers with the server's capture-closed refusal) and
 * `onSubscribe` runs while the room connection is being made.
 */
function harness(
  options: {
    readonly drop?: number;
    readonly closedOnDrop?: boolean;
    readonly consumerFails?: number;
    readonly closeThrows?: boolean;
    /** How long each history read takes. */
    readonly readMs?: number;
    /** Replaces the canned history answer for every read. */
    readonly read?: (request: {
      epoch: number;
      segmentId?: string;
    }) => { state: typeof state; calibration: typeof calibration } | 'closed';
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
    lease: async () => ({ epoch: 1 }),
    token: async () => ({ url: 'wss://media.invalid', token: 'token' }),
    read: (
      request: { epoch: number; segmentId?: string },
      signal?: AbortSignal,
    ) =>
      options.read === undefined && dropped && options.closedOnDrop
        ? closedForGood.read(request, signal)
        : (() => {
            reads++;
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
      consume: (async ({ signal }) => {
        if (options.consumerFails === undefined)
          return new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => resolve()),
          );
        await new Promise((resolve) =>
          setTimeout(resolve, options.consumerFails),
        );
        throw createAppError('INFRASTRUCTURE', 'append outlasted its retries');
      }) as never,
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

test('a failure is reported where it began, not where the session it stopped was waiting', async () => {
  assert({
    given:
      'the clip consumer failing while the batch loop has a history read in flight',
    should:
      'report the transcription stage, not the cancelled read it aborted (ISSUE-571 review)',
    actual: await harness({ consumerFails: 20, readMs: 50 }).done,
    expected: { cause: 'transcription', errorCode: 'INFRASTRUCTURE' },
  });
  assert({
    given: 'that failure, then a shutdown step that throws',
    should: 'still report the first failure',
    actual: await harness({
      consumerFails: 20,
      readMs: 50,
      closeThrows: true,
    }).done,
    expected: { cause: 'transcription', errorCode: 'INFRASTRUCTURE' },
  });
});

test('a LiveKit room that drops after connect is a connect failure, unless the Round closed', async () => {
  assert({
    given: 'the LiveKit room dropping while the Round still needs capture',
    should: 'report the connect stage rather than end cleanly',
    actual: await harness({ drop: 10 }).done,
    expected: { cause: 'connect', errorCode: 'INFRASTRUCTURE' },
  });
  assert({
    given:
      'the LiveKit room dropping because the server closed the capture for good',
    should: 'finish the session, as a terminal Round does',
    actual: await harness({ drop: 10, closedOnDrop: true }).done,
    expected: 'closed for good',
  });
  assert({
    given:
      'an identity update refused because LiveKit already closed the connection, before its close resolves',
    should: 'report the drop as connect, not as a refresh conflict',
    actual: await harness({ drop: 10, closingFirst: true }).done,
    expected: { cause: 'connect', errorCode: 'INFRASTRUCTURE' },
  });
});

test('an ended stream whose staged frame no batch took yet is never sealed in the loop', async () => {
  const ids = (label: string) => label.repeat(24);
  const [segment, next, seat] = [ids('g'), ids('h'), ids('p')];
  const calibration = {
    sentAtMs: 0,
    receivedAtMs: 1,
    serverNowMs: 10000,
    precisionMs: 1,
  };
  const snapshot = (
    segmentId: string,
    serverNow: string,
  ): { state: typeof state; calibration: typeof calibration } => ({
    calibration,
    state: {
      roundId: ROUND,
      version: 1,
      serverNow,
      status: 'active',
      transcriptAdmissionCutoff: null,
      participants: [
        { roundParticipantId: seat, identity: ids('i'), kind: 'human' },
      ],
      segment: {
        id: segmentId,
        sequence: segmentId === segment ? 0 : 1,
        type: 'speech',
        startedAt: new Date(segmentId === segment ? 9000 : 10050).toISOString(),
        endedAt: null,
        durationMs: 60000,
      },
      intervals:
        segmentId === segment
          ? [
              {
                id: ids('a'),
                roundParticipantId: seat,
                startedAt: new Date(10000).toISOString(),
                endedAt: null,
                startedVersion: 1,
                endedVersion: null,
              },
            ]
          : [],
      nextIntervalId: null,
    },
  });
  // The stale history page a segment-scoped read answers with: its serverNow
  // predates the frame, so every batch holds the frame back for the next one.
  const stale = snapshot(segment, new Date(10000).toISOString());
  // The loop's own reads: the segment still live at setup, then superseded
  // with three settle windows passing, then the capture closed for good.
  const loopAnswers: Array<ReturnType<typeof stale> | 'closed'> = [
    snapshot(segment, new Date(10001).toISOString()),
    snapshot(next, new Date(10050).toISOString()),
    snapshot(next, new Date(11500).toISOString()),
    snapshot(next, new Date(12250).toISOString()),
    'closed',
  ];
  const session = harness({
    read: (request) =>
      request.segmentId === segment ? stale : loopAnswers.shift()!,
    onSubscribe: (emit) => {
      emit({
        identity: ids('i'),
        trackId: 'track-a',
        sequence: 0,
        beforeMs: 20,
        afterMs: 20.1,
        pcm: new Int16Array(160).fill(7),
      });
    },
  });
  assert({
    given:
      "a stream whose segment the history superseded while the stream's frame sits staged, held back by every batch's stale segment read",
    should:
      'leave the stream unsealed until the loop ends, since staging still holds its frame (ISSUE-580)',
    actual: {
      ended: await session.done,
      seals: session.seals(),
    },
    expected: { ended: 'closed for good', seals: [8] },
  });
});
