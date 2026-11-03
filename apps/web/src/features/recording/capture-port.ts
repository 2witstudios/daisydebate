import { createAppError } from '@daisy/errors';
import type {
  BuiltRecordingMedia,
  CompetitionType,
  RecordingLifecycle,
  RecordingSource,
  RecordingEvent,
} from '@daisy/protocol';
import { transitionRecording } from '@daisy/protocol';
import { coverageStatement } from './coverage-statement';
import { captureEligibility } from './eligibility';
import type { RecordingInputs, RecordingRecord, RecordingStore } from './ports';
import { speechTimeline } from './speech-timeline';

type FailureReason = Extract<
  RecordingLifecycle,
  { status: 'failed' }
>['reason'];

/**
 * What capture and processing (REC-1.2) call. Each report is idempotent, so a
 * crash or an ambiguous vendor answer is resolved by reporting again. Ready
 * means verified: `mediaVerified` is the only way there, and it refuses a
 * Recording that is no longer open, such as one taken down mid-processing.
 */
export type RecordingCapturePort = {
  /** Null means this Round is not recorded, and capture must not start. */
  readonly request: (input: {
    readonly roundId: string;
    readonly competitionType: CompetitionType;
    readonly hostActorId: string | null;
    readonly hostOptedIn: boolean;
    readonly hostHoldsRecording: boolean;
  }) => Promise<RecordingRecord | null>;
  /** Each Egress attempt reports once it runs; a crash adds the next attempt. */
  readonly captureStarted: (
    recordingId: string,
    report: {
      readonly source: RecordingSource;
      readonly attempt: number;
      readonly egressId: string;
      readonly at: string;
    },
  ) => Promise<RecordingOutcome>;
  readonly captureEnded: (
    recordingId: string,
    report: { readonly at: string },
  ) => Promise<RecordingOutcome>;
  readonly mediaVerified: (
    recordingId: string,
    report: BuiltRecordingMedia,
  ) => Promise<RecordingOutcome>;
  readonly failed: (
    recordingId: string,
    report: { readonly reason: FailureReason; readonly at: string },
  ) => Promise<RecordingOutcome>;
};

/** `refused` tells capture to stop and delete nothing itself: the sweep owns that. */
export type RecordingOutcome = 'moved' | 'unchanged' | 'refused';

export const createRecordingCapturePort = ({
  store,
  inputs,
  nextId,
}: {
  readonly store: RecordingStore;
  readonly inputs: Pick<
    RecordingInputs,
    'readFloorIntervals' | 'readCoverageFacts' | 'readBroadcastRelease'
  >;
  readonly nextId: () => string;
}): RecordingCapturePort => {
  const report = async (
    recordingId: string,
    event: RecordingEvent,
  ): Promise<RecordingOutcome> => {
    const applied = await store.apply(recordingId, (record) =>
      transitionRecording(record, event),
    );
    if (applied.kind !== 'decided') throw createAppError('NOT_FOUND');
    return applied.transition.kind;
  };
  return {
    request: async (input) => {
      const eligibility = captureEligibility(input);
      if (eligibility === null) return null;
      return store.request({
        id: nextId(),
        roundId: input.roundId,
        class: input.competitionType === 'ranked' ? 'ranked' : 'casual',
        eligibility,
      });
    },
    captureStarted: (recordingId, started) =>
      report(recordingId, { type: 'capture_started', ...started }),
    captureEnded: (recordingId, { at }) =>
      report(recordingId, { type: 'capture_ended', at }),
    mediaVerified: async (recordingId, media) => {
      const record = await store.find(recordingId);
      if (record === null) throw createAppError('NOT_FOUND');
      // Only a Recording still processing can use this: a report that will be
      // refused or repeated reads nothing of the Round.
      if (record.lifecycle.status !== 'processing')
        return report(recordingId, {
          type: 'media_verified',
          media: { ...media, speeches: [] },
        });
      const capture = {
        startedAtMs: Date.parse(media.capturedFrom),
        durationMs: media.durationMs,
      };
      const { gaps, unrecorded } = coverageStatement({
        facts: await inputs.readCoverageFacts(record.roundId),
        capture: { ...capture, restartGaps: media.gaps },
        broadcastStopped: (await inputs.readBroadcastRelease(record.roundId))
          .stopped,
      });
      const speeches = speechTimeline(
        await inputs.readFloorIntervals(record.roundId),
        { ...capture, gaps },
      );
      return report(recordingId, {
        type: 'media_verified',
        media: {
          ...media,
          gaps: [...gaps],
          ...(unrecorded.length > 0 ? { unrecorded: [...unrecorded] } : {}),
          speeches: [...speeches],
        },
      });
    },
    failed: (recordingId, { reason, at }) =>
      report(recordingId, { type: 'failed', reason, at }),
  };
};
