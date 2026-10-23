import { randomBytes } from 'node:crypto';
import { createOpenRouter } from '@daisy/ai-voice';
import { createAudioPublication } from '@daisy/media/audio';
import { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { disposeCaptureRuntime } from '@daisy/media/capture';
import { systemId } from '@daisy/clock';
import { createRoundRuntimeOperations } from '../apps/web/src/features/round-runtime/operations';
import { createRoundMediaOperations } from '../apps/web/src/features/round-media/operations';
import { mediaRuntime } from '../apps/web/src/features/round-media/projection';
import { DEFAULT_BALLOT_DEADLINE_MS } from '../apps/web/src/features/round-finalization/maintenance';
import { createMediaWorkerTokenBroker } from '../apps/web/src/features/round-media/worker-token';
import { createMediaCaptureHandlers } from '../apps/web/src/features/media-capture/handlers';
import { createBotActivityRelay } from '../apps/web/src/features/round-bots/activity-relay';
import { mediaDependencies } from '../apps/web/integration/round-media.test-support';
import { mediaWorkerRole } from './test-logins';
import type { withRoomRuntime } from '../apps/web/integration/room-runtime.test-support';
import { CAPTURE_STT_LAG_MS } from '@daisy/protocol';

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
  await mediaOperations.session(roundId, f.host.actorId);
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
async function publishSpeech(token: string, pcm: Int16Array) {
  const publisher = await createAudioPublication({
    url: 'ws://127.0.0.1:7880',
    token,
    trackName: nextId(),
    sampleRate: 24000,
    channels: 1,
    monotonicNowMs: performance.now,
  });
  try {
    const anchor = performance.now(),
      count = Math.floor(pcm.length / 240);
    for (let i = 0; i < count; i++) {
      while (performance.now() < anchor + (i + 1) * 10)
        await Bun.sleep(Math.max(1, anchor + (i + 1) * 10 - performance.now()));
      await publisher.capture10ms(pcm.subarray(i * 240, (i + 1) * 240));
    }
  } catch (error) {
    await publisher.close();
    throw error;
  }
  return publisher;
}
export async function proveMediaWorker(f: Fixture, key: string, root: string) {
  const voice = createOpenRouter({ apiKey: key, fetch });
  const { roundId, deps, speech } = await startShortRound(f, voice);
  const [binding] =
    await f.sql`select s.id,s.room_name,p.identity from media_sessions s join media_participants p on p.session_id=s.id join round_participants r on r.id=p.round_participant_id where s.round_id=${roundId} and r.actor_id=${f.host.actorId}`;
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
  let publisher: Awaited<ReturnType<typeof createAudioPublication>> | undefined;
  try {
    await until(
      async () =>
        (await deps.media.participants(binding.room_name)).some(
          (p) => p.permission.hidden,
        ),
      10000,
      () => worker.exitCode !== null,
    );
    const token = await deps.media.joinToken({
      room: binding.room_name,
      identity: binding.identity,
      publish: ['microphone'],
      subscribe: false,
      capture: false,
    });
    publisher = await publishSpeech(token, speech.pcm);
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
      ballotDeadlineMs: DEFAULT_BALLOT_DEADLINE_MS,
    });
    const transcript = await f.store.readFrozenRoundTranscript(roundId);
    if (
      frozen.status !== 'frozen' ||
      !transcript ||
      transcript.completeness !== 'incomplete' ||
      transcript.utterances.length === 0 ||
      transcript.coverage.some((s) => s.state === 'open')
    )
      throw Error(
        'Actual captured text did not reach an immutable partial freeze',
      );
    process.stdout.write(
      JSON.stringify({
        proof: 'discovered-native-stt-signed-capture-freeze',
        providerPcmSamples: speech.pcm.length,
        capturedChunks: transcript.utterances.length,
        frontier: transcript.frontier,
        coverage: transcript.completeness,
        judgingAcceptance: false,
        fullRoundAcceptance: false,
      }) + '\n',
    );
  } finally {
    if (worker.exitCode === null) {
      worker.kill('SIGTERM');
      await worker.exited;
    }
    await publisher?.close();
    await server.stop(true);
    if (await deps.media.exists(binding.room_name))
      await deps.media.deleteRoom(binding.room_name);
    await disposeCaptureRuntime();
  }
}
