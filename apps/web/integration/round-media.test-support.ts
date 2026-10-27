import { createAdmissionPriority } from '../src/features/round-media/admission-priority';
import { Room, RoomEvent } from '@livekit/rtc-node';
import { createId } from '@paralleldrive/cuid2';
import { createMediaService } from '@daisy/media';
import { createLogger } from '@daisy/logger';
import { noopErrorReporter, withTimeout } from '@daisy/observability';
import {
  createBotActivityRelay,
  createBotHeardRelay,
} from '../src/features/round-bots/activity-relay';
import { createRoundMediaOperations } from '../src/features/round-media/operations';
import { createRoundRuntimeOperations } from '../src/features/round-runtime/operations';
import { mediaRuntime } from '../src/features/round-media/projection';
import { withRoomRuntime } from './room-runtime.test-support';
import {
  CAPTURE_COVERAGE_TOLERANCE,
  CAPTURE_STT_LAG_MS,
} from '@daisy/protocol';

export const localMediaConfig = {
  url: 'http://127.0.0.1:7880',
  apiKey: 'daisy-local',
  apiSecret: 'local-development-only-livekit-secret',
};
export const mediaDependencies = (
  fixture: Parameters<Parameters<typeof withRoomRuntime>[0]>[0],
  media = createMediaService({ config: localMediaConfig }),
) => ({
  priority: createAdmissionPriority({
    hint: fixture.redis.mediaAdmissionHint,
    logger: createLogger({ service: 'round-media-proof', level: 'silent' }),
  }),
  store: fixture.store.mediaSessions,
  media,
  publicUrl: 'wss://localhost.invalid',
  workerUrl: 'ws://127.0.0.1:7880',
  nextId: createId,
  reporter: noopErrorReporter,
  logger: createLogger({ service: 'round-media-proof', level: 'silent' }),
  deadline: <T>(work: Promise<T>) => withTimeout(work, 2000),
  wait: () => Bun.sleep(10),
});
export const withMediaRound = (
  work: (
    fixture: Parameters<Parameters<typeof withRoomRuntime>[0]>[0] & {
      readonly roundId: string;
      readonly mediaConfig: typeof localMediaConfig;
      readonly media: ReturnType<typeof createMediaService>;
      readonly mediaOperations: ReturnType<typeof createRoundMediaOperations>;
    },
  ) => Promise<void>,
) =>
  withRoomRuntime(async (fixture) => {
    const assembled = await fixture.assemble();
    const launched = await fixture.command(fixture.host, assembled, {
      type: 'start-round',
    });
    const roundId = launched.view.roundRef!.id;
    const deps = mediaDependencies(fixture);
    try {
      await work({
        ...fixture,
        roundId,
        mediaConfig: localMediaConfig,
        media: deps.media,
        mediaOperations: createRoundMediaOperations(deps),
      });
    } finally {
      const [session] =
        await fixture.sql`select room_name from media_sessions where round_id=${roundId}`;
      if (session && (await deps.media.exists(session.room_name)))
        await deps.media.deleteRoom(session.room_name);
    }
  });
export const tokenClaims = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
    sub: string;
    name: string;
    kind?: string;
    exp: number;
    nbf: number;
    video: Record<string, unknown>;
  };

/** Actual vendor/DB binding for the signed ingress and application composition proofs. */
export async function captureWorkerScope(
  fixture: Parameters<Parameters<typeof withMediaRound>[0]>[0],
) {
  await fixture.mediaOperations.session(fixture.roundId, fixture.host.actorId);
  const [session] =
    await fixture.sql`select id from media_sessions where round_id=${fixture.roundId}`;
  return {
    roundId: fixture.roundId,
    sessionId: String(session!.id),
    workerId: createId(),
  };
}

/** Actual capture operations over the fixture's same-pool store. */
export const captureOperations = (
  fixture: Parameters<Parameters<typeof withMediaRound>[0]>[0],
) =>
  fixture.store.createMediaCaptureOperations({
    sttLagMs: CAPTURE_STT_LAG_MS,
    coverageTolerance: CAPTURE_COVERAGE_TOLERANCE,
    nextId: createId,
    buildProjection: (context) =>
      mediaRuntime(context, createId).tick(context.now),
  });

/** A bare media session for the Round and actual capture operations at the production speech-to-text lag. */
export async function openRoundCapture(
  f: Parameters<Parameters<typeof withRoomRuntime>[0]>[0],
  roundId: string,
  buildProjection: Parameters<
    typeof f.store.createMediaCaptureOperations
  >[0]['buildProjection'],
) {
  const sessionId = createId(),
    workerId = createId();
  await f.sql`insert into media_sessions(id,round_id,room_name) values(${sessionId},${roundId},${createId()})`;
  return {
    sessionId,
    workerId,
    capture: f.store.createMediaCaptureOperations({
      sttLagMs: CAPTURE_STT_LAG_MS,
      coverageTolerance: CAPTURE_COVERAGE_TOLERANCE,
      nextId: createId,
      buildProjection,
    }),
  };
}

/** Hold actual provider creation before its effect or after acknowledgement, without replacing the vendor. */
export function delayedMediaCreation(phase: 'before' | 'after' = 'after') {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let delayed = false;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const creation = !delayed && url.pathname.endsWith('/CreateRoom');
      if (creation) delayed = true;
      if (creation && phase === 'before') {
        entered.resolve();
        await release.promise;
      }
      const response = await fetch(`${localMediaConfig.url}${url.pathname}`, {
        method: request.method,
        headers: request.headers,
        body: await request.arrayBuffer(),
      });
      if (creation && phase === 'after' && response.ok) {
        entered.resolve();
        await release.promise;
      }
      return response;
    },
  });
  return {
    config: { ...localMediaConfig, url: `http://127.0.0.1:${server.port}` },
    entered: entered.promise,
    release: () => release.resolve(),
    stop: () => server.stop(true),
  };
}
export async function waitForMediaFact(fact: () => Promise<boolean>) {
  const deadline = performance.now() + 3000;
  while (!(await fact())) {
    if (performance.now() >= deadline)
      throw new Error('Media fact was not observed before its deadline');
    await Bun.sleep(10);
  }
}

/** A worker lease claimed for the Round, then its first speech opened, as a capture worker sees it. */
export async function leasedCaptureSpeech(
  fixture: Parameters<Parameters<typeof withMediaRound>[0]>[0],
) {
  const scope = await captureWorkerScope(fixture);
  const capture = captureOperations(fixture);
  const lease = await capture.claimMediaWorkerLease({
    ...scope,
    leaseMs: 15000,
  });
  const identity = { ...scope, epoch: lease.epoch };
  await startCaptureSpeech(fixture);
  const segmentId = (await capture.readMediaCaptureState(identity)).segment!.id;
  return { scope, capture, identity, segmentId };
}

/** The production activity relay over the fixture's capture operations and Redis. */
export const captureActivityRelay = (
  fixture: Parameters<Parameters<typeof withMediaRound>[0]>[0],
  capture: ReturnType<typeof captureOperations>,
) =>
  createBotActivityRelay({
    readCapture: (identity) => capture.readMediaCaptureState(identity),
    readLease: (identity) => capture.readCurrentCaptureLease(identity),
    write: fixture.redis.writeBotActivity,
  });
export const captureHeardRelay = (
  fixture: Parameters<Parameters<typeof withMediaRound>[0]>[0],
  capture: ReturnType<typeof captureOperations>,
) =>
  createBotHeardRelay({
    readCapture: (identity) => capture.readMediaCaptureState(identity),
    readLease: (identity) => capture.readCurrentCaptureLease(identity),
    write: fixture.redis.writeCaptureHeard,
  });

/** Starts the launched Round and moves its clock past the countdown into the first speech. */
export async function startCaptureSpeech(
  fixture: Parameters<Parameters<typeof withMediaRound>[0]>[0],
) {
  const round = (await fixture.store.getRound(fixture.roundId))!;
  await createRoundRuntimeOperations({
    store: fixture.store,
    nextSegmentId: createId,
  }).command(
    { kind: 'human', actorId: fixture.host.actorId },
    fixture.roundId,
    {
      version: 1,
      commandId: createId(),
      expectedVersion: round.version,
      command: { type: 'start' },
    },
  );
  await fixture.sql`update rounds set started_at=clock_timestamp()-${round.rules.countdownMs + 1000}*interval '1 millisecond' where id=${fixture.roundId}`;
}
/**
 * Capture's report through actual LiveKit and Redis: a subscriber in the
 * Round's room writes the heard key, under the server's track id, for every
 * track it subscribes to, as the capture worker does (ISSUE-514-r2). Joined
 * on the first read, once the bot grant has opened the room; `close` also
 * deletes the room.
 */
export function hearRoundTracks(
  f: Parameters<Parameters<typeof withRoomRuntime>[0]>[0],
  deps: ReturnType<typeof mediaDependencies>,
  roundId: string,
  seat: string,
) {
  const room = new Room();
  room.on(RoomEvent.TrackSubscribed, (_track, publication) => {
    if (publication.sid)
      void f.redis.writeCaptureHeard({
        roundId,
        trackId: publication.sid,
        seat,
      });
  });
  let joining: Promise<void> | undefined;
  return {
    heard: async (round: string, trackSid: string) => {
      joining ??= (async () => {
        const [session] =
          await f.sql`select room_name from media_sessions where round_id=${roundId}`;
        await room.connect(
          deps.workerUrl,
          await deps.media.joinToken({
            room: session.room_name,
            identity: createId(),
            publish: [],
            subscribe: true,
            capture: true,
          }),
          { autoSubscribe: true, dynacast: false },
        );
      })();
      await joining;
      return f.redis.readCaptureHeard(round, trackSid);
    },
    /** Leaves, then deletes the Round's room if it still exists. */
    close: async () => {
      await room.disconnect();
      const [session] =
        await f.sql`select room_name from media_sessions where round_id=${roundId}`;
      if (session && (await deps.media.exists(session.room_name)))
        await deps.media.deleteRoom(session.room_name);
    },
  };
}
