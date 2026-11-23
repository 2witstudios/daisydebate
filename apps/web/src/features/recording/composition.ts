import { defineComposition } from '../../server/composition';
import type { Waits } from '@daisy/clock';
import { pollWork, type WorkWake } from '@daisy/worker';
import { LIVE_IDLE_MAX_MS } from '../../lib/worker-idle';
import { nowMs } from '@daisy/clock';
import { spectatorClockAt } from '../spectating/spectator-clock';
import { hostHoldsCasualCapture as holdsCasualCapture } from '../room-runtime/capture-offer';
import {
  broadcastPhase,
  captureRule,
  createRoundRuntime,
  plannedRecording,
} from '@daisy/debate-engine';
import { isJudgeSeat, isModeratorSeat } from '@daisy/protocol/seats';
import { identify } from '../../lib/identity';
import type { App } from '../../server/app';
import { stageEgressOf } from '../stage-capture/composition';
import { newStageCredential } from '../stage-capture/stage-access';
import { createRecordingCapturePort } from './capture-port';
import { holdsRecordingDownload } from './download-entitlement';
import { createRecordingCaptureSweep } from './capture-sweep';
import type { RecordingRound } from './audience';
import { createRecordingHandlers } from './handlers';
import type { HistoryInputs, HistoryRound } from './history';
import { recordingPersistence } from './persistence';
import type { YouthRoundPeople } from './youth-audience';
import { youthPeopleFor } from '@daisy/db/youth-live';
import type { RecordingInputs } from './ports';

/** As often as a Broadcast's: its own Egress has the same revocation lead to meet. */
const CAPTURE_SWEEP_EVERY_MS = 1000;
/** A slow Recording runs on past this; the next pass reaches the others on time. */
const PASS_BUDGET_MS = 750;

type RoundRow = NonNullable<
  Awaited<ReturnType<App['database']['readRecordingRound']>>
>;

const asRound = (
  round: RoundRow,
  youth: YouthRoundPeople | null,
): HistoryRound & RecordingRound => ({
  id: round.id,
  competitionType: round.competitionType,
  visibility: round.visibility,
  audienceLinkHash: round.audienceLinkHash,
  hostActorId: round.hostActorId,
  completedAtMs: round.completedAtMs,
  seatedActorIds: round.seats.map((seat) => seat.actorId),
  recordingPolicy: plannedRecording(round),
  officialActorIds: round.seats
    .filter((seat) => isJudgeSeat(seat.seat) || isModeratorSeat(seat.seat))
    .map((seat) => seat.actorId),
  youth,
  ladder: round.ladder,
  title: round.title,
  resolution: round.resolution,
  sides: round.sides,
  outcome: round.outcome,
  debaters: round.debaters.map((seat) => ({
    roundParticipantId: seat.roundParticipantId,
    actorId:
      round.seats.find((each) => each.id === seat.roundParticipantId)
        ?.actorId ?? null,
    seat: seat.seat,
    label: seat.label,
  })),
});

/** The one people cache of this app's reads, shared with the live audience (ADR 0155). */
const youthPeople = (app: App) => youthPeopleFor(app.database);

/** The named read-only inputs, in one place. */
const recordingInputs = (app: App): RecordingInputs & HistoryInputs => {
  const readRoundWith =
    (people: (roundId: string) => Promise<YouthRoundPeople>) =>
    async (roundId: string) => {
      const round = await app.database.readRecordingRound(roundId);
      if (!round) return null;
      // Any Round of a Youth Room, casual included (ADR 0157).
      if (!round.youthRound) return asRound(round, null);
      return asRound(round, await people(roundId));
    };
  const readHistoryRound = readRoundWith(youthPeople(app));
  const store = recordingPersistence(app);
  return {
    readRound: readHistoryRound,
    readRoundFresh: readRoundWith(app.database.readYouthRoundPeople),
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
    nowMs: () => nowMs(app.clock),
    holdsRecordingDownload: holdsRecordingDownload({
      readGrants: app.database.recordingCaptures.readAccountGrants,
      betaGrantsPremium: app.config.PREMIUM_BETA_GRANT,
      now: () => app.clock.now(),
    }),
    findRecordingByRound: store.findByRound,
    // The reuse fence in one statement, as Watch reads it (ADR 0161).
    readReuseFenced: app.database.readRoundReuseFenced,
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
export const startRecordingCapture = (
  app: App,
  waits: Waits,
  /** A Round changed: one may need recording now (ADR 0154). */
  wake?: WorkWake,
) => {
  const egress = stageEgressOf(app, waits);
  if (app.config.RECORDING_CAPTURE !== 'on' || !egress) return null;
  const sweep = createRecordingCaptureSweep({
    store: app.database.recordingCaptures,
    port: composeRecordingCapture(app),
    egress,
    holdsCapture: (grants) =>
      holdsCasualCapture(
        grants,
        app.config.PREMIUM_BETA_GRANT,
        app.clock.now(),
      ),
    phaseAt: (round, now) =>
      broadcastPhase(
        createRoundRuntime({
          ...round,
          round,
          nextSegmentId: () => app.ids.next(),
        }).position(now),
        round.rules.segments.length - 1,
      ),
    now: () => nowMs(app.clock),
    newCredential: () => newStageCredential(),
    stageUrl: (id, credential) =>
      `${app.config.PUBLIC_APP_URL}/stage/${id}?c=${encodeURIComponent(credential)}`,
    report: (event) => app.logger.log(event, {}, 'Recording capture'),
    passBudget: (signal?: AbortSignal) => waits.sleep(PASS_BUDGET_MS, signal),
  });
  const running = pollWork({
    pass: sweep,
    backoff: { busyMs: CAPTURE_SWEEP_EVERY_MS, idleMaxMs: LIVE_IDLE_MAX_MS },
    waits,
    wake,
    failed: () =>
      app.logger.log('recording.capture_failed', {}, 'Recording capture'),
  });
  return { stop: () => running.stop().then(sweep.settled) };
};

export const recordingReads = (app: App) => ({
  inputs: recordingInputs(app),
  archive: recordingPersistence(app),
});

/** recordings: its route files bind here (`processRoute`). */
export const recordingComposition = defineComposition('recordings', (app) =>
  composeRecordingRoutes(app),
);
