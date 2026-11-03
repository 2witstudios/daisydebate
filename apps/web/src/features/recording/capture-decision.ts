import {
  runningEgress,
  egressPrivacyActions,
  type StageEgressFact,
  type StagePhaseFact,
  type StagePrivacyAction,
} from '@daisy/debate-engine';
import { capturedMediaMs, recordingBuildCeilingMs } from '@daisy/protocol';
import type {
  RecordingJobState,
  RecordingLifecycle,
  RecordingSource,
} from '@daisy/protocol';

type EgressAttempt = {
  readonly attempt: number;
  readonly egressId: string;
  readonly startedAtMs: number;
};

/** A Round with a Broadcast: its Egress is read, never run, from here. */
type BroadcastPath = {
  readonly kind: 'broadcast';
  /** Null until the Broadcast has opened. */
  readonly broadcastId: string | null;
  readonly latest: EgressAttempt | null;
  readonly stopped: boolean;
  readonly egress: StageEgressFact;
};

/** A Recording with no Broadcast runs its own Egress under the same privacy rule. */
type OwnPath = {
  readonly kind: 'own';
  readonly latest: EgressAttempt | null;
  readonly egress: StageEgressFact;
  readonly phase: StagePhaseFact;
  readonly observerSubscribed: boolean;
  readonly revocationFailures: number;
};

export type RecordingCaptureFacts = {
  readonly nowMs: number;
  readonly lifecycle: RecordingLifecycle;
  /** The Round completed or was abandoned. */
  readonly roundEnded: boolean;
  readonly path: BroadcastPath | OwnPath;
};

export type RecordingCaptureAction =
  | {
      readonly type: 'report-started';
      readonly source: RecordingSource;
      readonly attempt: EgressAttempt;
    }
  | { readonly type: 'report-ended' }
  | { readonly type: 'report-failed' }
  | { readonly type: 'start-egress' }
  | { readonly type: 'stop-egress'; readonly id: string }
  | { readonly type: 'close-own-capture' }
  | Exclude<StagePrivacyAction, { type: 'stop-egress' }>;

const recordedThrough = (lifecycle: RecordingLifecycle): number =>
  lifecycle.status === 'capturing'
    ? (lifecycle.capture.attempts.at(-1)?.attempt ?? 0)
    : 0;

const isOpen = (lifecycle: RecordingLifecycle) =>
  lifecycle.status === 'requested' || lifecycle.status === 'capturing';

/** A capture that ended has an attempt to process; one that never started has failed. */
const endOf = (lifecycle: RecordingLifecycle): RecordingCaptureAction =>
  lifecycle.status === 'capturing'
    ? { type: 'report-ended' }
    : { type: 'report-failed' };

const newAttempt = (
  facts: RecordingCaptureFacts,
  source: RecordingSource,
): readonly RecordingCaptureAction[] => {
  const { latest } = facts.path;
  return latest && latest.attempt > recordedThrough(facts.lifecycle)
    ? [{ type: 'report-started', source, attempt: latest }]
    : [];
};

const decideBroadcastPath = (
  facts: RecordingCaptureFacts,
  path: BroadcastPath,
): readonly RecordingCaptureAction[] => {
  if (!isOpen(facts.lifecycle)) return [];
  const started = path.broadcastId
    ? newAttempt(facts, {
        kind: 'broadcast_hold',
        broadcastId: path.broadcastId,
      })
    : [];
  // Report each attempt before anything else, so none is lost to a Round that ended.
  if (started.length > 0) return started;
  const noMoreMedia =
    (facts.roundEnded || path.stopped) && !runningEgress(path.egress);
  return noMoreMedia ? [endOf(facts.lifecycle)] : [];
};

const decideOwnPath = (
  facts: RecordingCaptureFacts,
  path: OwnPath,
): readonly RecordingCaptureAction[] => {
  const live = runningEgress(path.egress);
  // Taken down or removed mid-capture, or the Round over: nothing more is captured.
  if (!isOpen(facts.lifecycle) || facts.roundEnded) {
    if (live) return [{ type: 'stop-egress', id: live.id }];
    const started = isOpen(facts.lifecycle)
      ? newAttempt(facts, { kind: 'own_capture' })
      : [];
    if (started.length > 0) return started;
    return [
      ...(isOpen(facts.lifecycle) ? [endOf(facts.lifecycle)] : []),
      { type: 'close-own-capture' },
    ];
  }
  const started = newAttempt(facts, { kind: 'own_capture' });
  const privacy = egressPrivacyActions({ ...facts, ...path }).map(
    (action): RecordingCaptureAction =>
      action.type === 'stop-egress'
        ? { type: 'stop-egress', id: action.id }
        : action,
  );
  return [
    ...started,
    ...privacy,
    ...(privacy.length > 0 || live ? [] : [{ type: 'start-egress' as const }]),
  ];
};

/** What the capture sweep does next, from observed facts alone. Pure and total. */
export const decideRecordingCapture = (
  facts: RecordingCaptureFacts,
): readonly RecordingCaptureAction[] =>
  facts.path.kind === 'broadcast'
    ? decideBroadcastPath(facts, facts.path)
    : decideOwnPath(facts, facts.path);

export type RecordingJobAnswer =
  | {
      readonly type: 'queue';
      readonly attemptCount: number;
      readonly ceilingMs: number;
    }
  | { readonly type: 'verify' }
  | {
      readonly type: 'fail';
      readonly reason: Extract<
        RecordingJobState,
        { status: 'failed' }
      >['reason'];
    }
  | { readonly type: 'discard-sources' };

/**
 * What the worker's report means for the Recording. Only `verify` can lead to
 * ready, through the capture port. Sources go once a Recording no longer needs
 * them and nothing else reads them. A taken-down or failed Recording keeps its
 * sources: moderation decides about evidence, and a failed one's cleanup comes
 * through removal.
 */
export const answerRecordingJob = (input: {
  readonly state: RecordingJobState;
  readonly lifecycle: RecordingLifecycle;
  readonly sourcesInUse: boolean;
  /** A debater's POV still writing: the build waits, so it reads all of it. */
  readonly povsOpen: boolean;
}): RecordingJobAnswer | null => {
  const { state, lifecycle, sourcesInUse, povsOpen } = input;
  if (state.status === 'settled' || state.status === 'discarding') return null;
  switch (lifecycle.status) {
    case 'processing':
      if (state.status === 'waiting' && povsOpen) return null;
      if (state.status === 'waiting')
        return {
          type: 'queue',
          attemptCount: lifecycle.capture.attempts.at(-1)?.attempt ?? 0,
          ceilingMs: recordingBuildCeilingMs(
            capturedMediaMs(lifecycle.capture),
          ),
        };
      if (state.status === 'built') return { type: 'verify' };
      return state.status === 'failed'
        ? { type: 'fail', reason: state.reason }
        : null;
    case 'ready':
    case 'removing':
    case 'removed':
      return sourcesInUse ? null : { type: 'discard-sources' };
    default:
      return null;
  }
};
