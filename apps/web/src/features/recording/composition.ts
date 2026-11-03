import { spectatorClockAt } from '../spectating/spectator-clock';
import { hostHoldsCasualCapture as holdsCasualCapture } from '../room-runtime/capture-offer';
import { captureRule, createRoundRuntime } from '@daisy/debate-engine';
import { identify } from '../../lib/identity';
import type { App } from '../../server/app';
import {
  startSingleFlightWorker,
  type WorkerTimers,
} from '../../lib/worker-timers';
import { stageEgressOf } from '../stage-capture/composition';
import { newStageCredential } from '../stage-capture/stage-access';
import { createRecordingCapturePort } from './capture-port';
import { createRecordingCaptureSweep } from './capture-sweep';
import type { RecordingRound } from './audience';
import { createRecordingHandlers } from './handlers';
import type { HistoryInputs, HistoryRound } from './history';
import { recordingPersistence } from './persistence';
import type { RecordingInputs } from './ports';

/** As often as a Broadcast's: its own Egress has the same revocation lead to meet. */
const CAPTURE_SWEEP_EVERY_MS = 1000;

type RoundRow = NonNullable<
  Awaited<ReturnType<App['database']['readRecordingRound']>>
>;

const asRound = (round: RoundRow): HistoryRound & RecordingRound => ({
  id: round.id,
  competitionType: round.competitionType,
  visibility: round.visibility,
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

/**
 * The named read-only inputs, in one place. A download takes WATCH-8's
 * subscription entitlement, granted to beta testers until billing exists.
 */
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
    readTranscript: (roundId) =>
      app.database.readRecordingTranscript(roundId, captureRule),
    readBallots: app.database.readRecordingBallots,
    holdsRecordingDownload: async (userId) =>
      holdsCasualCapture(
        await app.database.recordingCaptures.readAccountGrants(userId),
        app.config.PREMIUM_BETA_GRANT,
      ),
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
    positionAt: (round, now) =>
      createRoundRuntime({
        ...round,
        round,
        nextSegmentId: () => app.ids.next(),
      }).position(now),
    now: () => Date.parse(app.clock.now()),
    newCredential: () => newStageCredential(),
    stageUrl: (id, credential) =>
      `${app.config.PUBLIC_APP_URL}/stage/${id}?c=${encodeURIComponent(credential)}`,
    report: (event) => app.logger.log(event, {}, 'Recording capture'),
  });
  const running = startSingleFlightWorker({
    run: sweep,
    everyMs: CAPTURE_SWEEP_EVERY_MS,
    timers,
    failed: () =>
      app.logger.log('recording.capture_failed', {}, 'Recording capture'),
  });
  return { stop: running.stop };
};

export const recordingReads = (app: App) => ({
  inputs: recordingInputs(app),
  archive: recordingPersistence(app),
});
