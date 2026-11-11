import {
  recordingHiddenByModeration,
  recordingPreparationOf,
  type RecordingJobState,
  type RecordingPreparation,
} from '@daisy/protocol';
import type { RecordingMedia } from '@daisy/protocol';
import { UNDRAWN_RESOLUTION } from './archive';
import { resultHeadline } from './archive';
import { explainGaps, type RoundCoverageFacts } from './coverage-statement';
import {
  mayDownload,
  mayRequestRemoval,
  recordingMediaState,
  moderationHidesText,
  permissionsAfterModeration,
  roundEvidencePermissions,
  type BroadcastRelease,
  type RecordingMediaState,
  type RecordingRound,
  type RecordingViewer,
  type RoundEvidencePermissions,
} from './audience';
import type { RecordingRecord } from './ports';

/** The Round as the history screen shows it, beyond what permissions need. */
export type HistoryRound = RecordingRound & {
  readonly title: string | null;
  readonly resolution: string | null;
  readonly outcome: string | null;
  readonly debaters: readonly {
    readonly roundParticipantId: string | null;
    readonly role: string;
    readonly label: string | null;
  }[];
};

export type HistoryTranscript = {
  readonly revision: number;
  readonly completeness: 'complete' | 'incomplete';
  readonly gaps: readonly unknown[];
  readonly utterances: readonly {
    readonly id: string;
    readonly roundParticipantId: string;
    readonly text: string;
    readonly complete: boolean;
  }[];
};

export type HistoryBallot = {
  readonly winner: string;
  readonly reason: string;
  readonly scores: Readonly<
    Record<string, Readonly<Record<string, number>> | undefined>
  >;
};

export type HistoryInputs = {
  /** The processing job's state, read only to say how far a build is. */
  readonly nowMs: () => number;
  readonly readJobState: (
    recordingId: string,
  ) => Promise<RecordingJobState | null>;
  readonly readHistoryRound: (roundId: string) => Promise<HistoryRound | null>;
  readonly readBroadcastRelease: (roundId: string) => Promise<BroadcastRelease>;
  readonly readTranscript: (
    roundId: string,
  ) => Promise<HistoryTranscript | null>;
  readonly readBallots: (roundId: string) => Promise<readonly HistoryBallot[]>;
  readonly holdsRecordingDownload: (userId: string) => Promise<boolean>;
  readonly findRecordingByRound: (
    roundId: string,
  ) => Promise<RecordingRecord | null>;
  /** What a watchable video's gaps are stated against. */
  readonly readCoverageFacts: (roundId: string) => Promise<RoundCoverageFacts>;
};

type TranscriptPanel = {
  readonly q: string;
  readonly revision: number;
  /** Null when coverage is whole; otherwise what is missing, plainly. */
  readonly coverageNote: string | null;
  readonly rows: readonly {
    readonly id: string;
    readonly turn: number;
    readonly speaker: string;
    readonly text: string;
    readonly partial: boolean;
  }[];
};

type ResultPanel = {
  readonly headline: string;
  readonly ballots: readonly {
    readonly title: string;
    readonly winner: string;
    readonly scores: string;
    readonly reason: string;
  }[];
};

export type RecordingMediaPanel =
  | {
      readonly state: 'watch';
      /** An authorized read, never a bucket URL. */
      readonly playlistHref: string;
      readonly durationMs: number;
      /** What the video does not hold, stated rather than hidden. */
      readonly gaps: readonly RecordingMedia['gaps'][number][];
      /** Debate the video never reached, before its start or after its end. */
      readonly unrecorded: NonNullable<RecordingMedia['unrecorded']>;
      readonly speeches: readonly {
        readonly speaker: string;
        readonly startMs: number;
        readonly endMs: number;
      }[];
    }
  | {
      readonly state: 'processing';
      readonly preparation: RecordingPreparation | null;
    }
  | {
      readonly state:
        Exclude<RecordingMediaState, 'watch' | 'processing'> | 'withheld';
    };

export type RecordingHistoryScreen =
  | { readonly kind: 'unavailable' }
  | {
      readonly kind: 'history';
      readonly roundId: string;
      readonly title: string;
      readonly resolution: string;
      readonly ranked: boolean;
      readonly date: string;
      readonly visibility: RecordingRound['visibility'];
      readonly media: RecordingMediaPanel;
      /** Null means no text history may be shown to this viewer, or none exists. */
      readonly transcript: TranscriptPanel | null;
      readonly result: ResultPanel | null;
      readonly downloadHref: string | null;
      readonly removal: {
        readonly recordingId: string;
        readonly version: number;
      } | null;
      /** What a report from this page names: the Recording, or its Round if none. */
      readonly reportTarget: {
        readonly targetKind: 'recording' | 'round';
        readonly targetId: string;
        readonly label: string;
      };
    };

const sideName = (side: string): string =>
  side === 'affirmative' ? 'Affirmative' : 'Negative';

const coverageNote = (transcript: HistoryTranscript): string | null => {
  if (transcript.completeness === 'complete' && transcript.gaps.length === 0)
    return null;
  return transcript.gaps.length > 0
    ? `This transcript is partial: ${transcript.gaps.length} ${transcript.gaps.length === 1 ? 'stretch was' : 'stretches were'} not captured.`
    : 'This transcript is partial: some speech was not captured.';
};

const speakerOf = (round: HistoryRound, participantId: string): string => {
  const seat = round.debaters.find(
    (debater) => debater.roundParticipantId === participantId,
  );
  if (!seat) return 'Speaker';
  return seat.label === null ? sideName(seat.role) : `@${seat.label}`;
};

/** Actual turn order, numbered before any search so a match keeps its number. */
const transcriptPanel = (
  round: HistoryRound,
  transcript: HistoryTranscript,
  q: string,
): TranscriptPanel => {
  const needle = q.toLowerCase();
  return {
    q,
    revision: transcript.revision,
    coverageNote: coverageNote(transcript),
    rows: transcript.utterances
      .map((line, index) => ({
        id: line.id,
        turn: index + 1,
        speaker: speakerOf(round, line.roundParticipantId),
        text: line.text,
        partial: !line.complete,
      }))
      .filter((row) =>
        `${row.speaker} ${row.text}`.toLowerCase().includes(needle),
      ),
  };
};

const sideTotal = (ballot: HistoryBallot, side: string): number =>
  Object.values(ballot.scores[side] ?? {}).reduce((sum, n) => sum + n, 0);

/** Winner, scores and reason. Judges appear by number; feedback never reaches here. */
const resultPanel = (
  round: HistoryRound,
  ballots: readonly HistoryBallot[],
): ResultPanel => ({
  headline: resultHeadline(round.outcome),
  ballots: ballots.map((ballot, index) => ({
    title: `Judge ${index + 1}`,
    winner: sideName(ballot.winner),
    scores: `Affirmative ${sideTotal(ballot, 'affirmative')}, Negative ${sideTotal(ballot, 'negative')}`,
    reason: ballot.reason,
  })),
});

/**
 * The video for this viewer. `withheld` is a Broadcast stopped before this Round
 * ended: the rest of its record stays open, and its video does not (ISSUE-1094).
 */
const mediaPanel = (
  round: HistoryRound,
  record: RecordingRecord | null,
  mayWatch: boolean,
  job: RecordingJobState | null,
  nowMs: number,
  facts: RoundCoverageFacts | null,
): RecordingMediaPanel => {
  if (record?.lifecycle.status !== 'ready') {
    const state = recordingMediaState(record?.lifecycle.status ?? null);
    if (state === 'processing' && record)
      return {
        state,
        preparation: recordingPreparationOf(record.lifecycle, job, nowMs),
      };
    return {
      state: state as Exclude<RecordingMediaState, 'watch' | 'processing'>,
    };
  }
  if (!mayWatch) return { state: 'withheld' };
  const { media } = record.lifecycle;
  const speaker = (id: string) => {
    const seat = round.debaters.find((d) => d.roundParticipantId === id);
    if (!seat) return 'A speaker';
    return seat.label === null ? sideName(seat.role) : `@${seat.label}`;
  };
  return {
    state: 'watch',
    playlistHref: `/api/recordings/${record.id}/playback/${media.playlistKey.slice(media.playlistKey.lastIndexOf('/') + 1)}`,
    durationMs: media.durationMs,
    // Stated again against the Round, so a Recording stored before a turnover or a
    // prep was explained reads as one stated today.
    gaps: facts
      ? explainGaps(media.gaps, facts, Date.parse(media.capturedFrom))
      : media.gaps,
    unrecorded: media.unrecorded ?? [],
    speeches: media.speeches.map((speech) => ({
      speaker: speaker(speech.roundParticipantId),
      startMs: speech.startMs,
      endMs: speech.endMs,
    })),
  };
};

/** What this viewer may do with the Recording, each on its own rule. */
const recordingActions = (input: {
  readonly record: RecordingRecord | null;
  readonly round: HistoryRound;
  readonly viewer: RecordingViewer;
  readonly permissions: RoundEvidencePermissions;
  readonly subscribed: boolean;
}): Pick<
  Extract<RecordingHistoryScreen, { kind: 'history' }>,
  'downloadHref' | 'removal'
> => {
  const { record, round, viewer, permissions, subscribed } = input;
  if (record === null) return { downloadHref: null, removal: null };
  const status = record.lifecycle.status;
  return {
    downloadHref: mayDownload({ viewer, permissions, status, subscribed })
      ? `/api/recordings/${record.id}/download`
      : null,
    removal: mayRequestRemoval({
      recordingClass: record.class,
      round,
      viewer,
      status,
    })
      ? { recordingId: record.id, version: record.version }
      : null,
  };
};

const reportTargetOf = (record: RecordingRecord | null, roundId: string) =>
  record
    ? ({
        targetKind: 'recording',
        targetId: record.id,
        label: 'Report this recording',
      } as const)
    : ({
        targetKind: 'round',
        targetId: roundId,
        label: 'Report this round',
      } as const);

const permittedReads = (
  inputs: HistoryInputs,
  roundId: string,
  permissions: RoundEvidencePermissions,
  viewer: RecordingViewer,
) =>
  Promise.all([
    permissions.transcript ? inputs.readTranscript(roundId) : null,
    permissions.result ? inputs.readBallots(roundId) : null,
    viewer.kind === 'account'
      ? inputs.holdsRecordingDownload(viewer.userId)
      : false,
  ]);

/** The history route's one driver: who is asking decides each panel on its own. */
export const openRecordingHistory = async (
  inputs: HistoryInputs,
  input: {
    readonly roundId: string;
    readonly viewer: RecordingViewer;
    readonly presentedLinkHash: string | null;
    readonly q: string;
  },
): Promise<RecordingHistoryScreen> => {
  const round = await inputs.readHistoryRound(input.roundId);
  if (round === null || round.completedAtMs === null)
    return { kind: 'unavailable' };
  const admitted = roundEvidencePermissions(
    round,
    await inputs.readBroadcastRelease(round.id),
    input.viewer,
    input.presentedLinkHash,
  );
  if (!admitted.open) return { kind: 'unavailable' };
  const record = await inputs.findRecordingByRound(round.id);
  const hiddenByModeration =
    record !== null && recordingHiddenByModeration(record.lifecycle);
  const permissions = permissionsAfterModeration(
    admitted,
    round,
    input.viewer,
    hiddenByModeration,
  );
  const [transcript, readBallots, subscribed] = await permittedReads(
    inputs,
    round.id,
    permissions,
    input.viewer,
  );
  // The result stands; the ballots carry the judges' words, which go with the footage.
  const ballots =
    readBallots && moderationHidesText(round, input.viewer, hiddenByModeration)
      ? []
      : readBallots;
  const state = recordingMediaState(record?.lifecycle.status ?? null);
  // A public Round with neither video nor anything this viewer may read is not
  // offered: a stranger learns nothing from its page.
  if (state === 'not_recorded' && transcript === null && ballots === null)
    return { kind: 'unavailable' };
  return {
    kind: 'history',
    roundId: round.id,
    title: round.title ?? round.resolution ?? UNDRAWN_RESOLUTION,
    resolution: round.resolution ?? UNDRAWN_RESOLUTION,
    ranked: round.competitionType === 'ranked',
    date: new Date(round.completedAtMs).toISOString().slice(0, 10),
    visibility: round.visibility,
    media: mediaPanel(
      round,
      record,
      permissions.media,
      record && state === 'processing'
        ? await inputs.readJobState(record.id)
        : null,
      inputs.nowMs(),
      record && state === 'watch' && permissions.media
        ? await inputs.readCoverageFacts(round.id)
        : null,
    ),
    reportTarget: reportTargetOf(record, round.id),
    transcript: transcript && transcriptPanel(round, transcript, input.q),
    result: ballots && resultPanel(round, ballots),
    ...recordingActions({
      record,
      round,
      viewer: input.viewer,
      permissions,
      subscribed,
    }),
  };
};
