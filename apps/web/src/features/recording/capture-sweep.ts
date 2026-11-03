import {
  plannedBroadcast,
  plannedRecording,
  type StageEgressFact,
  type StagePhaseFact,
} from '@daisy/debate-engine';
import {
  holdAttemptPrefix,
  publicIntervals,
  recordingBuildDelayed,
  recordingHoldPrefix,
  type BuiltRecordingMedia,
  type EntitlementGrant,
  type RecordingSource,
} from '@daisy/protocol';
import type { createDatabase } from '@daisy/db';
import {
  answerRecordingJob,
  decideRecordingCapture,
  type RecordingCaptureAction,
  type RecordingCaptureFacts,
} from './capture-decision';
import { createSweepPass } from '../../lib/sweep-pass';
import type { RecordingCapturePort } from './capture-port';

type Store = Pick<
  ReturnType<typeof createDatabase>['recordingCaptures'],
  | 'discoverUnrecorded'
  | 'listOpen'
  | 'readRound'
  | 'openOwn'
  | 'claimOwn'
  | 'holdOwn'
  | 'recordOwnEgressStarted'
  | 'recordOwnRevoked'
  | 'recordOwnRevocationFailed'
  | 'recordOwnRestored'
  | 'closeOwn'
  | 'openJob'
  | 'queueJob'
  | 'readPublicHistory'
  | 'discardSources'
  | 'stripSources'
  | 'listJobs'
  | 'listProcessingUnalerted'
  | 'markDelayAlerted'
>;
type Open = Awaited<ReturnType<Store['listOpen']>>[number];

export type RecordingCaptureEvent =
  | 'recording.capture_failed'
  | 'recording.egress.start_failed'
  | 'recording.egress.start_lost'
  | 'recording.verification_refused'
  | 'recording.egress.stop_failed'
  | 'recording.observer.restore_failed'
  | 'recording.observer.revoke_retry_failed'
  | 'recording.processing_delayed';

type Egress = {
  readonly start: (input: {
    readonly stageUrl: string;
    readonly holdPrefix: string;
    readonly segmentSeconds: number;
  }) => Promise<string>;
  readonly stop: (id: string) => Promise<void>;
  readonly read: (id: string) => Promise<StageEgressFact>;
  readonly revokeObserver: (room: string) => Promise<unknown>;
  readonly restoreObserver: (room: string) => Promise<unknown>;
};

const SEGMENT_SECONDS = 4;
const BATCH = 64;
const RECONCILE_LEASE_MS = 800;
/** Long enough for any start; a crash inside one delays the next by this much. */
const START_LEASE_MS = 15_000;
const JOB_KEY = 'job:';
const DELAY_KEY = 'delay:';
/** A pass keys its rows apart; a page continues from the row's own id. */
const afterKey = (prefix: string, after: string | null) =>
  after === null ? null : after.slice(prefix.length);
const OWN_SOURCE: RecordingSource = { kind: 'own_capture' };

const attemptOf = (
  row: {
    readonly egressId: string | null;
    readonly attempt: number;
    readonly egressStartedAt: Date | null;
  },
  nowMs: number,
) =>
  row.egressId && row.attempt > 0
    ? {
        attempt: row.attempt,
        egressId: row.egressId,
        startedAtMs: row.egressStartedAt?.getTime() ?? nowMs,
      }
    : null;

const roundEnded = (status: string) =>
  status === 'completed' || status === 'abandoned';

/**
 * One pass over every unfinished capture and every job with something to answer.
 * Each report is idempotent, so a crash between two steps resolves itself on the
 * next pass. A failure on one Recording never stops the others or reaches a Round.
 */
export const createRecordingCaptureSweep = (deps: {
  readonly store: Store;
  readonly port: RecordingCapturePort;
  readonly egress: Egress;
  readonly holdsCapture: (grants: readonly EntitlementGrant[]) => boolean;
  /** What the stage may show now: read without a lock and without ticking the Round. */
  readonly phaseAt: (
    round: NonNullable<Awaited<ReturnType<Store['readRound']>>>['round'],
    now: string,
  ) => StagePhaseFact;
  readonly now: () => number;
  /** CSPRNG secret; only its SHA3-256 hash is stored. */
  readonly newCredential: () => {
    readonly secret: string;
    readonly hash: string;
  };
  readonly stageUrl: (recordingId: string, credential: string) => string;
  readonly report: (event: RecordingCaptureEvent) => void;
  /** Resolves when a pass has waited long enough for its slowest Recording. */
  readonly passBudget?: () => Promise<void>;
}) => {
  const { store, port, egress } = deps;
  const iso = (ms: number) => new Date(ms).toISOString();

  const attempt = async (
    work: () => Promise<unknown>,
    failed: () => Promise<unknown> | void,
  ) => {
    try {
      await work();
    } catch {
      await failed();
    }
  };

  const onBroadcast = (open: Open) =>
    plannedBroadcast({
      competitionType: open.competitionType,
      capture: open.roundCapture,
    }) !== null;

  const broadcastFacts = async (
    open: Open,
    nowMs: number,
  ): Promise<RecordingCaptureFacts> => {
    const { broadcast } = open;
    const stopped = broadcast?.stoppedAt != null;
    const ended = roundEnded(open.roundStatus);
    return {
      nowMs,
      lifecycle: open.lifecycle,
      roundEnded: ended,
      path: {
        kind: 'broadcast',
        broadcastId: broadcast?.id ?? null,
        latest: broadcast ? attemptOf(broadcast, nowMs) : null,
        stopped,
        // Only the end of capture depends on it, so LiveKit is asked only then.
        egress:
          broadcast?.egressId && (ended || stopped)
            ? await egress.read(broadcast.egressId)
            : { kind: 'none' },
      },
    };
  };

  const ownFacts = async (
    open: Open,
    nowMs: number,
    own: NonNullable<Open['own']>,
    phase: StagePhaseFact,
  ): Promise<RecordingCaptureFacts> => ({
    nowMs,
    lifecycle: open.lifecycle,
    roundEnded: roundEnded(open.roundStatus),
    path: {
      kind: 'own',
      latest: attemptOf(own, nowMs),
      egress: own.egressId ? await egress.read(own.egressId) : { kind: 'none' },
      phase,
      observerSubscribed: own.observerRevokedAt === null,
      revocationFailures: own.revocationFailures,
    },
  });

  const reportStarted = async (
    recordingId: string,
    action: Extract<RecordingCaptureAction, { type: 'report-started' }>,
  ) => {
    // The job comes first: a Recording that has sources always knows where.
    await store.openJob({
      recordingId,
      holdPrefix: recordingHoldPrefix(recordingId, action.source),
    });
    await port.captureStarted(recordingId, {
      source: action.source,
      attempt: action.attempt.attempt,
      egressId: action.attempt.egressId,
      at: iso(action.attempt.startedAtMs),
    });
  };

  const runCommon = (
    recordingId: string,
    action: RecordingCaptureAction,
    nowMs: number,
  ) => {
    switch (action.type) {
      case 'report-started':
        return reportStarted(recordingId, action);
      case 'report-ended':
        return port.captureEnded(recordingId, { at: iso(nowMs) });
      case 'report-failed':
        return port.failed(recordingId, {
          reason: 'capture_failed',
          at: iso(nowMs),
        });
      default:
        return null;
    }
  };

  const runOwn = (
    open: Open,
    own: NonNullable<Open['own']>,
    room: string | null,
    action: RecordingCaptureAction,
    nowMs: number,
  ) => {
    const recordingId = open.id;
    switch (action.type) {
      case 'start-egress': {
        const credential = deps.newCredential();
        const generation = own.attempt + 1;
        return attempt(
          async () => {
            // The claim outlasts the call, so no other instance starts another.
            await store.holdOwn({
              recordingId,
              until: new Date(nowMs + START_LEASE_MS),
            });
            const egressId = await egress.start({
              stageUrl: deps.stageUrl(recordingId, credential.secret),
              holdPrefix: holdAttemptPrefix(
                recordingHoldPrefix(recordingId, OWN_SOURCE),
                generation,
              ),
              segmentSeconds: SEGMENT_SECONDS,
            });
            const won = await store.recordOwnEgressStarted({
              recordingId,
              egressId,
              generation,
              stageCredentialHash: credential.hash,
              now: new Date(nowMs),
            });
            if (won) return;
            deps.report('recording.egress.start_lost');
            await egress.stop(egressId);
          },
          () => deps.report('recording.egress.start_failed'),
        ).finally(() => store.holdOwn({ recordingId, until: null }));
      }
      case 'stop-egress':
        return attempt(
          () => egress.stop(action.id),
          () => deps.report('recording.egress.stop_failed'),
        );
      case 'revoke-observer':
        return attempt(
          async () => {
            if (room) await egress.revokeObserver(room);
            await store.recordOwnRevoked({ recordingId, now: new Date(nowMs) });
          },
          () => store.recordOwnRevocationFailed(recordingId),
        );
      case 'reassert-revocation':
        return attempt(
          async () => {
            if (room) await egress.revokeObserver(room);
          },
          () => deps.report('recording.observer.revoke_retry_failed'),
        );
      case 'restore-observer':
        return attempt(
          async () => {
            if (room) await egress.restoreObserver(room);
            await store.recordOwnRestored(recordingId);
          },
          () => deps.report('recording.observer.restore_failed'),
        );
      case 'forget-revocation':
        return attempt(
          () => store.recordOwnRestored(recordingId),
          () => deps.report('recording.observer.restore_failed'),
        );
      case 'close-own-capture':
        return store.closeOwn({ recordingId, now: new Date(nowMs) });
      default:
        return runCommon(recordingId, action, nowMs);
    }
  };

  const reconcileOwn = async (open: Open, nowMs: number) => {
    await store.openOwn({ recordingId: open.id, roundId: open.roundId });
    const mine = await store.claimOwn({
      recordingId: open.id,
      now: new Date(nowMs),
      until: new Date(nowMs + RECONCILE_LEASE_MS),
    });
    if (!mine) return;
    const read = await store.readRound(open.roundId);
    if (!read) return;
    const phase = deps.phaseAt(read.round, iso(nowMs));
    const own = open.own ?? {
      recordingId: open.id,
      egressId: null,
      attempt: 0,
      egressStartedAt: null,
      observerRevokedAt: null,
      revocationFailures: 0,
    };
    const facts = await ownFacts(open, nowMs, own, phase);
    for (const action of decideRecordingCapture(facts))
      await runOwn(open, own, read.roomName, action, nowMs);
  };

  const reconcile = async (open: Open) => {
    const nowMs = deps.now();
    if (!onBroadcast(open)) return reconcileOwn(open, nowMs);
    const facts = await broadcastFacts(open, nowMs);
    for (const action of decideRecordingCapture(facts))
      await runCommon(open.id, action, nowMs);
    return undefined;
  };

  const answerJob = async (
    job: Awaited<ReturnType<Store['listJobs']>>[number],
  ) => {
    const answer = answerRecordingJob(job);
    if (answer === null) return;
    switch (answer.type) {
      case 'queue': {
        const history = await store.readPublicHistory(job.recordingId);
        await store.queueJob({
          recordingId: job.recordingId,
          attemptCount: answer.attemptCount,
          publicIntervals: publicIntervals(
            history.segments,
            history.knownThroughMs,
          ),
          ceilingMs: answer.ceilingMs,
        });
        return;
      }
      case 'verify':
        if (job.state.status !== 'built') return;
        // A refusal repeats on every pass, so it ends here, said out loud.
        if (
          (await port.mediaVerified(
            job.recordingId,
            job.state.media satisfies BuiltRecordingMedia,
          )) === 'refused'
        ) {
          deps.report('recording.verification_refused');
          await port.failed(job.recordingId, {
            reason: 'verification_failed',
            at: iso(deps.now()),
          });
        }
        return;
      case 'fail':
        await port.failed(job.recordingId, {
          reason: answer.reason,
          at: iso(deps.now()),
        });
        return;
      case 'strip-sources': {
        const history = await store.readPublicHistory(job.recordingId);
        await store.stripSources({
          recordingId: job.recordingId,
          publicIntervals: publicIntervals(
            history.segments,
            history.knownThroughMs,
          ),
        });
        return;
      }
      case 'discard-sources':
        await store.discardSources(job.recordingId);
    }
  };

  /** Tells an operator once. The build carries on: a timer fails nothing. */
  const alertIfDelayed = async ({
    id,
    lifecycle,
  }: Awaited<ReturnType<Store['listProcessingUnalerted']>>[number]) => {
    const nowMs = deps.now();
    if (
      lifecycle.status === 'processing' &&
      recordingBuildDelayed(lifecycle.capture, nowMs) &&
      (await store.markDelayAlerted({ recordingId: id, at: new Date(nowMs) }))
    )
      deps.report('recording.processing_delayed');
  };

  const failed = () => deps.report('recording.capture_failed');
  const pass = createSweepPass(deps.passBudget);
  const sweep = async () => {
    for (const round of await store.discoverUnrecorded(BATCH))
      await (async () => {
        if (!plannedRecording(round)) return;
        await port.request({
          roundId: round.roundId,
          competitionType: round.competitionType,
          hostActorId: round.hostActorId,
          hostOptedIn: round.capture?.recording === true,
          hostHoldsRecording: deps.holdsCapture(round.hostGrants),
        });
      })().catch(failed);
    await pass.overPages(
      BATCH,
      (after) => store.listOpen(BATCH, after),
      (open) => open.id,
      reconcile,
      failed,
    );
    await pass.overPages(
      BATCH,
      (after) => store.listJobs(BATCH, afterKey(JOB_KEY, after)),
      (job) => `${JOB_KEY}${job.recordingId}`,
      answerJob,
      failed,
    );
    await pass.overPages(
      BATCH,
      (after) =>
        store.listProcessingUnalerted(BATCH, afterKey(DELAY_KEY, after)),
      (row) => `${DELAY_KEY}${row.id}`,
      alertIfDelayed,
      failed,
    );
  };
  return Object.assign(sweep, { settled: pass.settled });
};
