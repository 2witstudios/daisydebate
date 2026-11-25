import { recordingHiddenByModeration } from '@daisy/protocol/recording';
import {
  recordingPreparationOf,
  type RecordingJobState,
  type RecordingPreparation,
} from '@daisy/protocol/recording-processing';
import { pointsTotal } from '@daisy/protocol/ballot-schema';
import {
  seatLabel,
  sideOfSeat,
  type SeatRef,
  type Side,
} from '@daisy/protocol/seats';
import { type Ladder } from '@daisy/protocol/ladder';
import { type RecordingMedia } from '@daisy/protocol/recording';
import { type RoundOutcome } from '@daisy/protocol/round-outcome';
import { sideName } from '../debate-room/seat-names';
import { UNDRAWN_RESOLUTION } from './archive';
import { resultHeadline } from './archive';
import {
  coverageParts,
  type LostGap,
  type PrivateGap,
} from './coverage-statement';
import {
  mayDownload,
  mayRequestRemoval,
  recordingMediaState,
  moderationHidesText,
  permissionsAfterModeration,
  recordingDeletionDueMs,
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
  /** The format's declared sides, in order; none for an unsided format. */
  readonly sides: readonly Side[];
  readonly outcome: RoundOutcome | null;
  /** The ladder a ranked Round rated on; null for casual. */
  readonly ladder: Ladder | null;
  readonly debaters: readonly {
    readonly roundParticipantId: string | null;
    /** The seat's actor, to pair it with a Youth Round's people. */
    readonly actorId: string | null;
    readonly seat: SeatRef;
    readonly label: string | null;
  }[];
};

type HistoryTranscript = {
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

type HistoryBallot = {
  /** Null for a ballot that named no winning side. */
  readonly winner: string | null;
  readonly reason: string | null;
  /** Each scored subject's score: a number, or a criteria grid; null for a ballot with no points. */
  readonly scores: Readonly<
    Record<string, number | Readonly<Record<string, number>> | undefined>
  > | null;
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
  /** Read only when an unrecorded casual Round could offer Premium. */
  readonly holdsCasualCapture: (userId: string) => Promise<boolean>;
  /** The reuse fence (ADR 0161), read only when a download could be offered. */
  readonly readReuseFenced: (roundId: string) => Promise<boolean>;
  readonly findRecordingByRound: (
    roundId: string,
  ) => Promise<RecordingRecord | null>;
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
    readonly reason: string | null;
  }[];
};

export type RecordingMediaPanel =
  | {
      readonly state: 'watch';
      /** An authorized read, never a bucket URL. */
      readonly playlistHref: string;
      readonly durationMs: number;
      /** Debate the video does not hold, stated rather than hidden. */
      readonly lost: readonly LostGap[];
      /** Stretches withheld by design, such as prep. */
      readonly keptPrivate: readonly PrivateGap[];
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
      readonly ladder: Ladder | null;
      readonly date: string;
      readonly visibility: RecordingRound['visibility'];
      /** A Youth Round: its youth and their linked adults may take it down. */
      readonly youth: boolean;
      /** An officials' Recording's deletion date (YYYY-MM-DD); null for any other. */
      readonly deletesOn: string | null;
      readonly media: RecordingMediaPanel;
      /** Null means no text history may be shown to this viewer, or none exists. */
      readonly transcript: TranscriptPanel | null;
      readonly result: ResultPanel | null;
      readonly downloadHref: string | null;
      /** What Premium would add here for an account without it; one at most. */
      readonly premiumOffer: RecordingPremiumOffer;
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

const coverageNote = (transcript: HistoryTranscript): string | null => {
  if (transcript.completeness === 'complete' && transcript.gaps.length === 0)
    return null;
  return transcript.gaps.length > 0
    ? `This transcript is partial: ${transcript.gaps.length} ${transcript.gaps.length === 1 ? 'stretch was' : 'stretches were'} not captured.`
    : 'This transcript is partial: some speech was not captured.';
};

/** A seat with no name on record reads by its side, or by the seat itself. */
const unnamedSeat = (round: HistoryRound, seat: SeatRef): string => {
  const side = sideOfSeat(seat);
  return side !== null
    ? sideName(round.sides, side)
    : seatLabel(
        round.sides,
        seat,
        round.debaters.filter((debater) => debater.seat.kind === seat.kind)
          .length,
      );
};

const speakerOf = (round: HistoryRound, participantId: string): string => {
  const seat = round.debaters.find(
    (debater) => debater.roundParticipantId === participantId,
  );
  if (!seat) return 'Speaker';
  return seat.label === null ? unnamedSeat(round, seat.seat) : `@${seat.label}`;
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

/** "Affirmative 34, Negative 31": each scored subject's total, sides in declared order. */
const scoreLine = (round: HistoryRound, ballot: HistoryBallot): string => {
  const scores = ballot.scores ?? {};
  const sideKeys = round.sides.map((side) => side.key);
  const subjects = [
    ...sideKeys.filter((key) => key in scores),
    ...Object.keys(scores).filter((key) => !sideKeys.includes(key)),
  ];
  return subjects
    .map((key) => {
      const name = sideKeys.includes(key)
        ? sideName(round.sides, key)
        : speakerOf(round, key);
      return `${name} ${pointsTotal(scores[key] ?? 0)}`;
    })
    .join(', ');
};

/** Winner, scores and reason. Judges appear by number; feedback never reaches here. */
const resultPanel = (
  round: HistoryRound,
  ballots: readonly HistoryBallot[],
): ResultPanel => ({
  headline: resultHeadline(round.outcome, round.sides),
  ballots: ballots.map((ballot, index) => ({
    title: `Judge ${index + 1}`,
    winner:
      ballot.winner === null
        ? 'No winner'
        : sideName(round.sides, ballot.winner),
    scores: scoreLine(round, ballot),
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
    return seat.label === null
      ? unnamedSeat(round, seat.seat)
      : `@${seat.label}`;
  };
  return {
    state: 'watch',
    playlistHref: `/api/recordings/${record.id}/playback/${media.playlistKey.slice(media.playlistKey.lastIndexOf('/') + 1)}`,
    durationMs: media.durationMs,
    ...coverageParts(media.gaps),
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
  readonly reuseFenced: boolean;
}): Pick<
  Extract<RecordingHistoryScreen, { kind: 'history' }>,
  'downloadHref' | 'removal'
> => {
  const { record, round, viewer, permissions, subscribed, reuseFenced } = input;
  if (record === null) return { downloadHref: null, removal: null };
  const status = record.lifecycle.status;
  return {
    downloadHref: mayDownload({
      reuseFenced,
      viewer,
      permissions,
      status,
      subscribed,
    })
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

const deletionDay = (round: HistoryRound): string | null => {
  const due = recordingDeletionDueMs(round);
  return due === null ? null : new Date(due).toISOString().slice(0, 10);
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

export type RecordingPremiumOffer = 'record' | 'download' | null;

/**
 * The page's one Premium offer (ADR 0933). `record`: a debater
 * or the host opened their own casual Round and it was never recorded. `download`: an
 * account may watch a ready video and lacks only the download entitlement.
 * A Youth Round offers neither, and a failed entitlement read offers none.
 */
const premiumOfferOf = async (
  inputs: Pick<HistoryInputs, 'holdsCasualCapture'>,
  input: {
    readonly round: HistoryRound;
    readonly viewer: RecordingViewer;
    readonly state: RecordingMediaState;
    readonly watchable: boolean;
    readonly subscribed: boolean;
  },
): Promise<RecordingPremiumOffer> => {
  const { round, viewer, state } = input;
  if (viewer.kind !== 'account' || round.youth !== null) return null;
  if (
    state === 'not_recorded' &&
    round.competitionType !== 'ranked' &&
    (round.hostActorId === viewer.actorId ||
      round.debaters.some((seat) => seat.actorId === viewer.actorId))
  )
    return (await inputs.holdsCasualCapture(viewer.userId).catch(() => true))
      ? null
      : 'record';
  return input.watchable && !input.subscribed ? 'download' : null;
};

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
    inputs.nowMs(),
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
    ladder: round.ladder,
    youth: round.youth !== null,
    date: new Date(round.completedAtMs).toISOString().slice(0, 10),
    visibility: round.visibility,
    deletesOn: deletionDay(round),
    media: mediaPanel(
      round,
      record,
      permissions.media,
      record && state === 'processing'
        ? await inputs.readJobState(record.id)
        : null,
      inputs.nowMs(),
    ),
    reportTarget: reportTargetOf(record, round.id),
    transcript: transcript && transcriptPanel(round, transcript, input.q),
    result: ballots && resultPanel(round, ballots),
    premiumOffer: await premiumOfferOf(inputs, {
      round,
      viewer: input.viewer,
      state,
      watchable: permissions.media && record?.lifecycle.status === 'ready',
      subscribed,
    }),
    ...recordingActions({
      record,
      round,
      viewer: input.viewer,
      permissions,
      subscribed,
      // Read only when a subscriber could otherwise download it.
      reuseFenced:
        subscribed && permissions.media && record?.lifecycle.status === 'ready'
          ? await inputs.readReuseFenced(round.id).catch(() => true)
          : true,
    }),
  };
};
