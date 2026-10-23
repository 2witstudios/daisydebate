import { randomBytes } from 'node:crypto';
import { createOpenRouter } from '@daisy/ai-voice';
import { createAudioPublication } from '@daisy/media/audio';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { disposeCaptureRuntime } from '@daisy/media/capture';
import { systemId } from '@daisy/clock';
import { createRoundRuntimeOperations } from '../apps/web/src/features/round-runtime/operations';
import { createRoundMediaOperations } from '../apps/web/src/features/round-media/operations';
import { mediaRuntime } from '../apps/web/src/features/round-media/projection';
import {
  DEFAULT_BALLOT_DEADLINE_MS,
  judgingPlan,
} from '../apps/web/src/features/round-finalization/maintenance';
import { createMediaWorkerTokenBroker } from '../apps/web/src/features/round-media/worker-token';
import { createMediaCaptureHandlers } from '../apps/web/src/features/media-capture/handlers';
import { createBotActivityRelay } from '../apps/web/src/features/round-bots/activity-relay';
import { mediaDependencies } from '../apps/web/integration/round-media.test-support';
import { mediaWorkerRole } from './test-logins';
import type { withRoomRuntime } from '../apps/web/integration/room-runtime.test-support';
import {
  CAPTURE_COVERAGE_TOLERANCE,
  CAPTURE_STT_LAG_MS,
} from '@daisy/protocol';

type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
const nextId = () => systemId.next();
const secret = randomBytes(32).toString('base64url');
async function until(
  fact: () => Promise<boolean>,
  timeoutMs: number,
  failed: () => boolean = () => false,
) {
  const end = performance.now() + timeoutMs;
  while (!(await fact())) {
    if (failed() || performance.now() >= end)
      throw Error('Actual capture proof condition was not observed');
    await Bun.sleep(25);
  }
}
async function startShortRound(
  f: Fixture,
  voice: ReturnType<typeof createOpenRouter>,
) {
  const choice = (await f.operations.catalog(f.host)).find(
    (c) => c.formatId === 'foundation',
  )!;
  const durations = { AC: 40000, NC: 40000 };
  const definition = {
    ...choice.definition,
    segments: choice.definition.segments.map((s) => ({
      ...s,
      defaultDurationMs: durations[s.key as keyof typeof durations],
    })),
    configurable: {
      ...choice.definition.configurable,
      timing: {
        countdownMs: { min: 0, max: 0 },
        segmentDurationMs: {
          AC: { min: 40000, max: 40000 },
          NC: { min: 40000, max: 40000 },
        },
      },
    },
  };
  const config = {
    ...choice.defaultConfig,
    inRoundPrep: { enabled: false as const },
    speechTiming: { countdownMs: 0, segmentDurationOverrides: {} },
  };
  const room = await f.assemble({
    selection: {
      kind: 'custom',
      definition,
      config,
      length: 'full',
      competitionType: 'casual',
    },
  });
  const speech = await voice.speakPcm({
    model: 'deepgram/aura-2',
    voice: 'aura-2-thalia-en',
    text: 'The recorded evidence supports a careful and fair decision.',
  });
  const launched = await f.command(f.host, room, { type: 'start-round' });
  const roundId = launched.view.roundRef!.id;
  const deps = mediaDependencies(f);
  const mediaOperations = createRoundMediaOperations(deps);
  // Both debaters join, so each speaking grant has a published track: the
  // host's carries speech, the guest's only silence.
  await mediaOperations.session(roundId, f.host.actorId);
  await mediaOperations.session(roundId, f.guest.actorId);
  const runtime = createRoundRuntimeOperations({
    store: f.store,
    nextSegmentId: nextId,
  });
  await runtime.command({ kind: 'human', actorId: f.host.actorId }, roundId, {
    version: 1,
    commandId: nextId(),
    expectedVersion: 1,
    command: { type: 'start' },
  });
  return { roundId, deps, speech };
}
function ingress(f: Fixture, deps: ReturnType<typeof mediaDependencies>) {
  const capture = f.store.createMediaCaptureOperations({
    sttLagMs: CAPTURE_STT_LAG_MS,
    coverageTolerance: CAPTURE_COVERAGE_TOLERANCE,
    nextId,
    buildProjection: (context) =>
      mediaRuntime(context, nextId).tick(context.now),
  });
  const broker = createMediaWorkerTokenBroker({
    sessions: deps.store,
    capture,
    media: deps.media,
    workerUrl: deps.workerUrl,
    nextId,
    deadline: deps.deadline,
  });
  const authentication = createMediaWorkerAuthentication({
    secret,
    now: Date.now,
  });
  const handlers = createMediaCaptureHandlers({
    logger: deps.logger,
    authentication: () => authentication,
    capture: () => capture,
    token: (scope, principal) => broker.captureToken(scope, principal),
    activity: createBotActivityRelay({
      readCapture: (value) => capture.readMediaCaptureState(value),
      readLease: (value) => capture.readCurrentCaptureLease(value),
      write: f.redis.writeBotActivity,
    }),
  });
  return Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handlers.handle });
}
/**
 * Publishes 10 ms frames without a gap until stopped: the PCM first, then
 * silence. Every speaking grant is then continuously captured, so each stream
 * can seal complete; frames outside a seat's grant are refused by the worker.
 */
async function publishContinuously(
  token: string,
  pcm: Int16Array,
  stop: AbortSignal,
) {
  const publisher = await createAudioPublication({
    url: 'ws://127.0.0.1:7880',
    token,
    trackName: nextId(),
    sampleRate: 24000,
    channels: 1,
    monotonicNowMs: performance.now,
  });
  const silence = new Int16Array(240);
  const anchor = performance.now();
  const publishing = (async () => {
    for (let i = 0; !stop.aborted; i++) {
      while (performance.now() < anchor + (i + 1) * 10)
        await Bun.sleep(Math.max(1, anchor + (i + 1) * 10 - performance.now()));
      const frame =
        (i + 1) * 240 <= pcm.length
          ? pcm.subarray(i * 240, (i + 1) * 240)
          : silence;
      await publisher.capture10ms(frame);
    }
  })();
  return {
    async close() {
      await publishing.catch(() => undefined);
      await publisher.close();
    },
  };
}
export async function proveMediaWorker(f: Fixture, key: string, root: string) {
  const voice = createOpenRouter({ apiKey: key, fetch });
  const { roundId, deps, speech } = await startShortRound(f, voice);
  const bindings =
    await f.sql`select s.room_name,p.identity,r.actor_id from media_sessions s join media_participants p on p.session_id=s.id join round_participants r on r.id=p.round_participant_id where s.round_id=${roundId} and r.actor_id in ${f.sql([f.host.actorId, f.guest.actorId])}`;
  const binding = bindings.find(
    (b: { actor_id: string }) => b.actor_id === f.host.actorId,
  )!;
  const server = ingress(f, deps);
  // The supervisor discovers the session itself under the worker login.
  const workerUrl = new URL(process.env.TEST_DATABASE_URL!);
  workerUrl.username = mediaWorkerRole.user;
  workerUrl.password = mediaWorkerRole.password;
  const worker = Bun.spawn(
    [process.execPath, 'run', '--cwd', 'apps/media-worker', 'start'],
    {
      cwd: root,
      env: {
        NODE_ENV: 'development',
        MEDIA_WORKER_DATABASE_URL: workerUrl.toString(),
        PUBLIC_APP_URL: `http://127.0.0.1:${server.port}`,
        MEDIA_WORKER_SECRET: secret,
        OPENROUTER_API_KEY: key,
      },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'ignore',
    },
  );
  const events = new Response(worker.stdout).text().then((text) =>
    text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as { event: string }).event),
  );
  const publishing = new AbortController();
  const publishers: { close: () => Promise<void> }[] = [];
  try {
    await until(
      async () =>
        (await deps.media.participants(binding.room_name)).some(
          (p) => p.permission.hidden,
        ),
      10000,
      () => worker.exitCode !== null,
    );
    // The host speaks then holds silence; the guest's seat stays silent.
    for (const seat of bindings) {
      const token = await deps.media.joinToken({
        room: seat.room_name,
        identity: seat.identity,
        publish: ['microphone'],
        subscribe: false,
        capture: false,
      });
      publishers.push(
        await publishContinuously(
          token,
          seat.actor_id === f.host.actorId ? speech.pcm : new Int16Array(0),
          publishing.signal,
        ),
      );
    }
    await until(
      async () => {
        const [row] =
          await f.sql`select count(*)::int as n from utterances where round_id=${roundId} and clip_key is not null`;
        return row.n > 0;
      },
      55000,
      () => worker.exitCode !== null,
    );
    await until(
      async () => {
        const [row] =
          await f.sql`select final_segment_ended_at is not null as ended from rounds where id=${roundId}`;
        return row.ended;
      },
      90000,
      () => worker.exitCode !== null,
    );
    worker.kill('SIGTERM');
    const code = await worker.exited;
    const logged = await events;
    if (code !== 0 || logged.join() !== 'server.ready,server.shutdown')
      throw Error('Discovered capture process failed to drain safely');
    const instanceId = nextId();
    await f.store.renewServiceInstance({ instanceId, role: 'web' });
    const frozen = await f.store.finalizeDueRoundTranscript({
      instanceId,
      roundId,
      buildProjection: (context) =>
        mediaRuntime(context, nextId).tick(context.now),
      planJudging: judgingPlan(DEFAULT_BALLOT_DEADLINE_MS),
    });
    const transcript = await f.store.readFrozenRoundTranscript(roundId);
    // The worker seals each stream before the cutoff (VIDEO-4.1): anything but a
    // complete freeze is a failure, never an accepted partial result.
    if (
      frozen.status !== 'frozen' ||
      !transcript ||
      transcript.completeness !== 'complete' ||
      transcript.utterances.length === 0 ||
      transcript.coverage.some((s) => s.state !== 'complete')
    )
      throw Error('Actual captured text did not reach a complete freeze');
    process.stdout.write(
      JSON.stringify({
        proof: 'discovered-native-stt-signed-capture-freeze',
        providerPcmSamples: speech.pcm.length,
        capturedChunks: transcript.utterances.length,
        frontier: transcript.frontier,
        coverage: transcript.completeness,
        judgingAcceptance: false,
        fullRoundAcceptance: true,
      }) + '\n',
    );
  } finally {
    if (worker.exitCode === null) {
      worker.kill('SIGTERM');
      await worker.exited;
    }
    publishing.abort();
    await Promise.all(publishers.map((each) => each.close()));
    await server.stop(true);
    if (await deps.media.exists(binding.room_name))
      await deps.media.deleteRoom(binding.room_name);
    await disposeCaptureRuntime();
  }
}
