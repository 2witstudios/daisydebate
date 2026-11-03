import { captureRule } from '@daisy/debate-engine';
import { identify } from '../../lib/identity';
import type { App } from '../../server/app';
import { createRecordingCapturePort } from './capture-port';
import type { RecordingRound } from './audience';
import { createRecordingHandlers } from './handlers';
import type { HistoryInputs, HistoryRound } from './history';
import { recordingPersistence } from './persistence';
import type { RecordingInputs } from './ports';

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
 * The named read-only inputs, in one place. Downloads stay refused until WATCH-8
 * supplies `holdsRecordingDownload`: an absent entitlement is never a grant.
 */
const recordingInputs = (app: App): RecordingInputs & HistoryInputs => {
  const readHistoryRound = async (roundId: string) => {
    const round = await app.database.readRecordingRound(roundId);
    return round && asRound(round);
  };
  const store = recordingPersistence();
  return {
    readRound: readHistoryRound,
    readHistoryRound,
    readBroadcastRelease: app.database.readRecordingBroadcastRelease,
    readFloorIntervals: app.database.readRecordingFloorIntervals,
    readTranscript: (roundId) =>
      app.database.readRecordingTranscript(roundId, captureRule),
    readBallots: app.database.readRecordingBallots,
    holdsRecordingDownload: async () => false,
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
    store: recordingPersistence(),
    objects: app.recordingObjects,
    inputs: recordingInputs(app),
  });

/** What capture and processing (REC-1.2) are given. */
export const composeRecordingCapture = (app: App) =>
  createRecordingCapturePort({
    store: recordingPersistence(),
    inputs: recordingInputs(app),
    nextId: () => app.ids.next(),
  });

export const recordingReads = (app: App) => ({
  inputs: recordingInputs(app),
  archive: recordingPersistence(),
});
