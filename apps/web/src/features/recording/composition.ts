import { spectatorClockAt } from '../spectating/spectator-clock';
import { hostHoldsCasualCapture as holdsCasualCapture } from '../room-runtime/capture-offer';
import {
  broadcastPhase,
  captureRule,
  createRoundRuntime,
} from '@daisy/debate-engine';
import { identify } from '../../lib/identity';
import type { App } from '../../server/app';
import {
  startSingleFlightWorker,
  type WorkerTimers,
} from '../../lib/worker-timers';
import { createPovEgress } from '@daisy/media/pov';
import { povCaptureIdOfPath } from '@daisy/protocol';
import { stageEgressOf } from '../stage-capture/composition';
import { createStrayEgressSweep } from '../stage-capture/stray-egress-sweep';
import { newStageCredential } from '../stage-capture/stage-access';
import { createRecordingCapturePort } from './capture-port';
import { holdsRecordingDownload } from './download-entitlement';
import { createRecordingCaptureSweep } from './capture-sweep';
import { createPovCaptureSweep } from './pov-capture-sweep';
import type { RecordingRound } from './audience';
import { createRecordingHandlers } from './handlers';
import type { HistoryInputs, HistoryRound } from './history';
import { recordingPersistence } from './persistence';
import type { RecordingInputs } from './ports';

/** As often as a Broadcast's: its own Egress has the same revocation lead to meet. */
const CAPTURE_SWEEP_EVERY_MS = 1000;
/** A slow Recording runs on past this; the next pass reaches the others on time. */
const PASS_BUDGET_MS = 750;

type RoundRow = NonNullable<
  Awaited<ReturnType<App['database']['readRecordingRound']>>
>;

const asRound = (round: RoundRow): HistoryRound & RecordingRound => ({
  id: round.id,
  competitionType: round.competitionType,
  visibility: round.visibility,
  audienceLinkHash: round.audienceLinkHash,
  hostActorId: round.hostActorId,
  completedAtMs: round.completedAtMs,
  seatedActorIds: round.seats.map((seat) => seat.actorId),
  title: round.title,
  resolution: round.resolution,
  outcome: round.outcome,
  debaters: round.debaters.map((seat) => ({
    roundParticipantId: seat.roundParticipantId,
    role: seat.role,
    label: seat.label,
  })),
});

/** The named read-only inputs, in one place. */
const recordingInputs = (app: App): RecordingInputs & HistoryInputs => {
  const readHistoryRound = async (roundId: string) => {
    const round = await app.database.readRecordingRound(roundId);
    return round && asRound(round);
  };
  const store = recordingPersistence(app);
  return {
    readRound: readHistoryRound,
    readHistoryRound,
    readBroadcastRelease: (roundId) =>
      app.database.readRecordingBroadcastRelease(
        roundId,
        spectatorClockAt(app.clock.now()),
      ),
    readFloorIntervals: app.database.readRecordingFloorIntervals,
    readCoverageFacts: app.database.readRecordingCoverageFacts,
    readTranscript: (roundId) =>
      app.database.readRecordingTranscript(roundId, captureRule),
    readBallots: app.database.readRecordingBallots,
    readJobState: app.database.recordingCaptures.readJobState,
    nowMs: () => Date.parse(app.clock.now()),
    holdsRecordingDownload: holdsRecordingDownload({
      readGrants: app.database.recordingCaptures.readAccountGrants,
      betaGrantsPremium: app.config.PREMIUM_BETA_GRANT,
    }),
    findRecordingByRound: store.findByRound,
  };
};

export const composeRecordingRoutes = (app: App) =>
  createRecordingHandlers({
    logger: app.logger,
    reporter: app.reporter,
    origin: () => app.auth().config.PUBLIC_APP_URL,
    identify: (request) => identify(app.auth(), request.headers),
    limiter: () => app.limiter,
    clock: app.clock,
    store: recordingPersistence(app),
    objects: app.recordingObjects,
    inputs: recordingInputs(app),
  });

/** What capture and processing (REC-1.2) are given. */
const composeRecordingCapture = (app: App) =>
  createRecordingCapturePort({
    store: recordingPersistence(app),
    inputs: recordingInputs(app),
    nextId: () => app.ids.next(),
  });

/**
 * Inert unless RECORDING_CAPTURE is on, so merging never activates capture. It
 * reads the Broadcast and the Round; a failure here reaches neither.
 */
export const startRecordingCapture = (app: App, timers: WorkerTimers) => {
  const egress = stageEgressOf(app);
  if (app.config.RECORDING_CAPTURE !== 'on' || !egress) return null;
  const sweep = createRecordingCaptureSweep({
    store: app.database.recordingCaptures,
    port: composeRecordingCapture(app),
    egress,
    holdsCapture: (grants) =>
      holdsCasualCapture(grants, app.config.PREMIUM_BETA_GRANT),
    phaseAt: (round, now) =>
      broadcastPhase(
        createRoundRuntime({
          ...round,
          round,
          nextSegmentId: () => app.ids.next(),
        }).position(now),
        round.rules.segments.length - 1,
      ),
    now: () => Date.parse(app.clock.now()),
    newCredential: () => newStageCredential(),
    stageUrl: (id, credential) =>
      `${app.config.PUBLIC_APP_URL}/stage/${id}?c=${encodeURIComponent(credential)}`,
    report: (event) => app.logger.log(event, {}, 'Recording capture'),
    passBudget: () => Bun.sleep(PASS_BUDGET_MS),
  });
  const running = startSingleFlightWorker({
    run: sweep,
    everyMs: CAPTURE_SWEEP_EVERY_MS,
    timers,
    failed: () =>
      app.logger.log('recording.capture_failed', {}, 'Recording capture'),
  });
  return { stop: () => running.stop().then(sweep.settled) };
};

const STRAY_POV_SWEEP_EVERY_MS = 15_000;
const STRAY_POV_CLAIM_MS = 800;

/**
 * Inert unless RECORDING_CAPTURE is on, and it starts nothing unless
 * RECORDING_POV_CAPTURE is too, so merging never activates capture. With the switch
 * off it still finishes what ran, so no build or conversation waits on it. A failure
 * here reaches no composite and no Round.
 */
export const startPovCapture = (app: App, timers: WorkerTimers) => {
  const {
    LIVEKIT_URL: url,
    LIVEKIT_API_KEY: apiKey,
    LIVEKIT_API_SECRET: apiSecret,
  } = app.config;
  if (app.config.RECORDING_CAPTURE !== 'on' || !url || !apiKey || !apiSecret)
    return null;
  // One LiveKit today. Every call already names its room, so more only change this.
  const egress = createPovEgress({ config: { url, apiKey, apiSecret } });
  const store = app.database.recordingPovs;
  const report = (event: Parameters<typeof app.logger.log>[0]) =>
    app.logger.log(event, {}, 'Recording POV capture');
  const sweep = createPovCaptureSweep({
    store,
    enabled: app.config.RECORDING_POV_CAPTURE === 'on',
    egressFor: () => egress,
    phaseAt: (round, now) =>
      broadcastPhase(
        createRoundRuntime({
          ...round,
          round,
          nextSegmentId: () => app.ids.next(),
        }).position(now),
        round.rules.segments.length - 1,
      ),
    now: () => Date.parse(app.clock.now()),
    report,
    passBudget: () => Bun.sleep(PASS_BUDGET_MS),
  });
  const running = startSingleFlightWorker({
    run: sweep,
    everyMs: CAPTURE_SWEEP_EVERY_MS,
    timers,
    failed: () => report('recording.pov_capture_failed'),
  });
  const povOf = (captureId: string) => {
    const [recordingId = '', roundParticipantId = ''] = captureId.split('/');
    return { recordingId, roundParticipantId };
  };
  const stray = startSingleFlightWorker({
    run: createStrayEgressSweep({
      listStages: async () =>
        (await egress.listRunning()).flatMap(({ egressId, path }) => {
          const captureId = povCaptureIdOfPath(path);
          return captureId ? [{ egressId, captureId }] : [];
        }),
      stop: egress.stop,
      owners: [
        {
          recordedEgress: (captureId) => store.readEgress(povOf(captureId)),
          claim: (captureId) => {
            const nowMs = Date.parse(app.clock.now());
            return store.claim({
              ...povOf(captureId),
              now: new Date(nowMs),
              until: new Date(nowMs + STRAY_POV_CLAIM_MS),
            });
          },
        },
      ],
      report,
    }),
    everyMs: STRAY_POV_SWEEP_EVERY_MS,
    timers,
    failed: () => report('stage.stray_sweep_failed'),
  });
  return {
    stop: () => Promise.all([running.stop().then(sweep.settled), stray.stop()]),
  };
};

export const recordingReads = (app: App) => ({
  inputs: recordingInputs(app),
  archive: recordingPersistence(app),
});
