import {
  isDebatingSeat,
  sideOfSeat,
  type CompetitionType,
  type RecordingStatus,
  type RoundOutcome,
  type SeatRef,
  type Side,
} from '@daisy/protocol';
import { sideName } from '../debate-room/seat-names';
import type { spectatorClockAt } from '../spectating/spectator-clock';
import { replayHref } from '../watch/routes';
import type { RecordingsQuery } from './archive-query';
import {
  recordingMediaState,
  roundEvidencePermissions,
  type BroadcastRelease,
  type RecordingMediaState,
  type RecordingRound,
  type RecordingViewer,
  type RoundEvidencePermissions,
} from './audience';

/** What a Recording shows for a Round that ended before its topic was drawn. */
export const UNDRAWN_RESOLUTION = 'No topic drawn';

/** One finished Round the archive store found for a query. */
export type ArchiveRound = Omit<RecordingRound, 'audienceLinkHash'> & {
  readonly title: string | null;
  /** Null when the Round ended in its opening, before a topic was drawn. */
  readonly resolution: string | null;
  readonly competitionType: CompetitionType;
  readonly release: BroadcastRelease;
  readonly status: RecordingStatus | null;
  readonly durationMs: number | null;
  readonly hasTranscript: boolean;
  /** The format's declared sides, in order; none for an unsided format. */
  readonly sides: readonly Side[];
  readonly outcome: RoundOutcome | null;
  readonly debaters: readonly {
    readonly seat: SeatRef;
    readonly label: string | null;
  }[];
};

export type ArchivePage = {
  readonly rows: readonly ArchiveRound[];
  readonly nextBefore: string | null;
};

/** The archive's read, paged in SQL so filters never run over a whole table. */
export type RecordingArchiveStore = {
  readonly listArchive: (input: {
    readonly query: RecordingsQuery;
    readonly viewerActorId: string | null;
    readonly clock: ReturnType<typeof spectatorClockAt>;
    readonly limit: number;
    /** The youth-publishing release flag (ADR 0151). */
    readonly youthPublishing: boolean;
  }) => Promise<ArchivePage>;
  readonly countPublicArchive: (input: {
    readonly clock: ReturnType<typeof spectatorClockAt>;
    readonly youthPublishing: boolean;
  }) => Promise<number>;
};

export type ArchiveEntry = {
  readonly roundId: string;
  readonly href: string;
  readonly title: string;
  readonly ranked: boolean;
  readonly date: string;
  readonly length: string | null;
  /** Who debated, one line per side in declared order (or per seat, unsided). */
  readonly seats: readonly string[];
  /** Null unless this viewer may read the result. */
  readonly result: string | null;
  /** `withheld` is ready video this viewer may not play, as its page says. */
  readonly media: RecordingMediaState | 'withheld';
  readonly transcript: boolean;
  /** Set only for the viewer's own Rounds: who else can open this. */
  readonly ownVisibility: RecordingRound['visibility'] | null;
};

type Debater = ArchiveRound['debaters'][number];

const namesOf = (debaters: readonly Debater[]): string =>
  debaters
    .map((seat) => (seat.label === null ? 'A closed seat' : `@${seat.label}`))
    .join(', ') || 'Unknown';

/**
 * Who debated: each side's debaters on one line, in the format's declared
 * order; an unsided format's speakers one each.
 */
export const debaterLines = (round: {
  readonly sides: readonly Side[];
  readonly debaters: readonly Debater[];
}): readonly string[] =>
  round.sides.length > 0
    ? round.sides.map((side) =>
        namesOf(
          round.debaters.filter((seat) => sideOfSeat(seat.seat) === side.key),
        ),
      )
    : round.debaters
        .filter((seat) => isDebatingSeat(seat.seat))
        .map((seat) => namesOf([seat]));

/** "Affirmative wins", "Ranked: Opening Government first". Ties are null: there is no draw to report (DEC-116). */
export const resultHeadline = (
  outcome: RoundOutcome | null,
  sides: readonly Side[],
): string => {
  if (outcome === null) return 'No winner';
  switch (outcome.kind) {
    case 'winner':
      return `${sideName(sides, outcome.side)} wins`;
    case 'ranking': {
      const first = outcome.places[0] ?? [];
      return outcome.of === 'sides'
        ? `${first.map((key) => sideName(sides, key)).join(' and ')} first`
        : 'Speakers ranked';
    }
  }
};

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const minutes = (durationMs: number): string =>
  `${Math.max(1, Math.round(durationMs / 60_000))} min`;

const listed = (
  round: ArchiveRound,
  permissions: RoundEvidencePermissions,
  media: ArchiveEntry['media'],
  transcript: boolean,
): boolean =>
  permissions.open &&
  round.completedAtMs !== null &&
  (media !== 'not_recorded' || transcript || permissions.result);

/**
 * Each row the store found, re-decided for this viewer. The store's filter keeps
 * the page cheap; this is the authority, so a store bug cannot leak a Round, a
 * result or a transcript link. A row with nothing permitted is not shown at all.
 */
export const archiveEntries = (
  page: ArchivePage,
  viewer: RecordingViewer,
  nowMs: number,
): readonly ArchiveEntry[] =>
  page.rows.flatMap((round): readonly ArchiveEntry[] => {
    // A list carries no link: an unlisted Round is listed only to its insiders.
    const permissions = roundEvidencePermissions(
      { ...round, audienceLinkHash: null },
      round.release,
      viewer,
      null,
      nowMs,
    );
    const stored = recordingMediaState(round.status);
    const media =
      stored === 'watch' && !permissions.media ? 'withheld' : stored;
    const transcript = permissions.transcript && round.hasTranscript;
    if (!listed(round, permissions, media, transcript)) return [];
    const own =
      viewer.kind === 'account' &&
      round.seatedActorIds.includes(viewer.actorId);
    return [
      {
        roundId: round.id,
        href: replayHref(round.id),
        title: round.title ?? round.resolution ?? UNDRAWN_RESOLUTION,
        ranked: round.competitionType === 'ranked',
        date: day(round.completedAtMs ?? 0),
        length:
          media === 'watch' && round.durationMs !== null
            ? minutes(round.durationMs)
            : null,
        seats: debaterLines(round),
        result: permissions.result
          ? resultHeadline(round.outcome, round.sides)
          : null,
        media,
        transcript,
        // A Youth Round is private whatever its Room says (ADR 0150).
        ownVisibility: own
          ? round.youth === null
            ? round.visibility
            : 'private'
          : null,
      },
    ];
  });

/** How many Rounds one archive page lists. */
export const ARCHIVE_PAGE_SIZE = 25;
