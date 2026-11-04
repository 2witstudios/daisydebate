import { z } from 'zod';

/** Capture time in which the stage is known to have shown public speech. */
const publicIntervalSchema = z.strictObject({
  fromMs: z.int().nonnegative(),
  toMs: z.int().nonnegative(),
});
export const publicIntervalsSchema = z.array(publicIntervalSchema).max(10_000);
export type PublicInterval = z.infer<typeof publicIntervalSchema>;

/**
 * Egress stamps media later than it was made, and more so as an attempt ages. Measured
 * on staging: +42 to +890 ms over 10 short attempts, and across one 80 minute attempt
 * audio +772 to about +1147 ms by 73 minutes, video +740 to about +1074, each rising
 * about 5 ms a minute. A clock difference between web and Egress adds to this.
 *
 * A start waits the most the stamp can lag at that age, because private media made
 * before it can carry a stamp this late. Above the measured lag by design: it costs
 * up to about 500 ms of public speech at each start, and fails closed.
 */
const START_EDGE_STAMP_LAG_BASE_MS = 1300;
const START_EDGE_STAMP_LAG_MS_PER_MINUTE = 6;
/**
 * An end needs none: the stamp is never early, so every stamp at or after the end may
 * be private, and none before it can be. This costs about 800 to 1100 ms of public
 * speech at each end.
 */
const END_EDGE_STAMP_LAG_MS = 0;

/**
 * Before prep the end gives up this much, and elsewhere nothing. At the smaller Egress
 * machine (performance-2x) stamps ran as much as 655 ms early, so a debater's first
 * words in prep could carry a stamp before prep began. Prep is the owner's hard line, and
 * losing this much public speech before it is accepted. The cause of the early stamps is
 * not found (ISSUE-1303).
 */
const BEFORE_PREP_MARGIN_MS = 700;

/**
 * The lag a start allows for. `captureFromMs` is when the capture was opened, which is
 * before any Egress attempt of it, so age can only be overstated: a restarted attempt
 * loses a little more speech, and nothing private gets through.
 */
const startEdgeLagMs = (edgeMs: number, captureFromMs: number) =>
  START_EDGE_STAMP_LAG_BASE_MS +
  Math.ceil(
    (Math.max(0, edgeMs - captureFromMs) / 60_000) *
      START_EDGE_STAMP_LAG_MS_PER_MINUTE,
  );

/** Shorter than this holds no usable word, and players trip on it. */
const SHORTEST_CLIP_MS = 200;

type CommittedSegment = {
  readonly startedAtMs: number;
  readonly endedAtMs: number | null;
  readonly durationMs: number;
};

/**
 * What committed Round history proves public: each speech or cross-examination,
 * its start past the stamp lag, to its end. Nothing else is, so anything with no row, prep and
 * every private phase included, is not. A segment still open is known only as far
 * as the control plane has been heard from, and never past its scheduled end. If
 * history later closes it, that proves the stretch (the point guard's rule): a late
 * commit is the only way anything unknown becomes public, and time alone never does.
 */
export const publicIntervals = (
  segments: readonly CommittedSegment[],
  knownThroughMs: number | null,
  captureFromMs: number,
  /** When each prep began. Whatever is public stops short of it. */
  prepStartsAtMs: readonly number[],
): readonly PublicInterval[] =>
  segments
    .map((segment) => {
      const toMs =
        (segment.endedAtMs ??
          Math.min(
            segment.startedAtMs + segment.durationMs,
            knownThroughMs ?? segment.startedAtMs,
          )) + END_EDGE_STAMP_LAG_MS;
      return {
        fromMs:
          segment.startedAtMs +
          startEdgeLagMs(segment.startedAtMs, captureFromMs),
        toMs: Math.min(
          toMs,
          ...prepStartsAtMs
            .filter(
              (startMs) =>
                startMs >= segment.startedAtMs &&
                startMs < toMs + BEFORE_PREP_MARGIN_MS,
            )
            .map((startMs) => startMs - BEFORE_PREP_MARGIN_MS),
        ),
      };
    })
    .filter(({ fromMs, toMs }) => toMs > fromMs)
    .sort((a, b) => a.fromMs - b.fromMs);

type Captured = {
  readonly capturedAtMs: number;
  readonly durationMs: number;
};

/**
 * Whether history is settled for all of this media. Until the control plane has
 * been heard from past it, by the stamp lag, a commit could still say anything about it, so it waits.
 * What is settled stays settled, so positions in the clips below never shift.
 */
export const settledByHeartbeat = (
  entry: Captured,
  knownThroughMs: number | null,
): boolean =>
  knownThroughMs !== null &&
  entry.capturedAtMs + entry.durationMs + START_EDGE_STAMP_LAG_BASE_MS <=
    knownThroughMs;

/** A part of one held segment to publish; `offsetMs` is where it starts inside it. */
export type PublicClip<
  T extends Captured,
  I extends PublicInterval = PublicInterval,
> = {
  readonly source: T;
  readonly interval: I;
  readonly offsetMs: number;
  readonly capturedAtMs: number;
  readonly durationMs: number;
};

/**
 * Held media cut to the intervals, to the millisecond: a segment straddling a
 * boundary keeps each side under its own interval. Whole segments go only where no
 * interval touches them at all.
 */
export const publicClips = <T extends Captured, I extends PublicInterval>(
  entries: readonly T[],
  intervals: readonly I[],
): readonly PublicClip<T, I>[] =>
  entries.flatMap((source) =>
    intervals.flatMap((interval) => {
      const startMs = Math.max(interval.fromMs, source.capturedAtMs);
      const endMs = Math.min(
        interval.toMs,
        source.capturedAtMs + source.durationMs,
      );
      return endMs - startMs < SHORTEST_CLIP_MS
        ? []
        : [
            {
              source,
              interval,
              offsetMs: startMs - source.capturedAtMs,
              capturedAtMs: startMs,
              durationMs: endMs - startMs,
            },
          ];
    }),
  );

/** What the audience's feed shows in a stretch of the Round. */
export type StageInterval = PublicInterval & {
  /**
   * `speech` is published as held. `between` is the stage's slate from the hold with
   * its audio replaced by silence, so nothing can be heard, even from a next speaker's
   * microphone opening just before their clock. `private`
   * reads nothing from the hold: a generated slate and silence, since a phase's first
   * moments can still hold a camera frame until the page and the revocation catch up.
   */
  readonly kind: 'speech' | 'between' | 'private';
};

export type PrivateSpan = {
  readonly kind: 'prep' | 'judging';
  readonly startedAtMs: number;
  readonly endedAtMs: number | null;
};

/**
 * The whole feed from committed history. Going into something more private a boundary
 * uses the least lag, and coming out of it the most, so nothing private is ever under
 * a more public kind. The stretch between two committed spans is `between`, because a
 * private phase would have committed its own. A stretch nothing bounds yet is unknown:
 * it has no interval, so it waits.
 */
export const stageTimeline = (history: {
  readonly segments: readonly CommittedSegment[];
  readonly privateSpans: readonly PrivateSpan[];
  readonly knownThroughMs: number | null;
  readonly captureFromMs: number;
}): readonly StageInterval[] => {
  const known = history.knownThroughMs;
  const privates = history.privateSpans.map((span) => ({
    kind: 'private' as const,
    fromMs:
      span.kind === 'prep'
        ? span.startedAtMs - BEFORE_PREP_MARGIN_MS
        : span.startedAtMs + END_EDGE_STAMP_LAG_MS,
    toMs:
      span.endedAtMs === null
        ? (known ?? span.startedAtMs)
        : span.endedAtMs +
          startEdgeLagMs(span.endedAtMs, history.captureFromMs),
  }));
  const speeches = publicIntervals(
    history.segments,
    known,
    history.captureFromMs,
    history.privateSpans
      .filter((span) => span.kind === 'prep')
      .map((span) => span.startedAtMs),
  ).map((interval) => ({
    ...interval,
    kind: 'speech' as const,
  }));
  const placed: readonly StageInterval[] = [...speeches, ...privates]
    .filter(({ fromMs, toMs }) => toMs > fromMs)
    .sort((a, b) => a.fromMs - b.fromMs);
  return placed.flatMap((interval, index): readonly StageInterval[] => {
    const previous = placed[index - 1];
    return previous && interval.fromMs > previous.toMs
      ? [
          { kind: 'between', fromMs: previous.toMs, toMs: interval.fromMs },
          interval,
        ]
      : [interval];
  });
};

type RoundFacts = {
  readonly stage: string | null;
  readonly activePrep: {
    readonly startedAtMs: number;
    readonly consumedMs: number;
  } | null;
};

export type PrivateSpanChange =
  | {
      readonly type: 'open';
      readonly kind: PrivateSpan['kind'];
      readonly atMs: number;
    }
  | {
      readonly type: 'close';
      readonly kind: PrivateSpan['kind'];
      readonly atMs: number;
    };

/**
 * What one Round transition commits to the record of its private spans. Prep ends
 * at the time it actually used, which a late tick can only learn afterwards. Judging
 * starts when the final segment ended, for the same reason.
 */
export const privateSpanChanges = (
  before: RoundFacts,
  after: RoundFacts & { readonly consumedNowMs: number },
  nowMs: number,
  finalSegmentEndedAtMs: number | null,
): readonly PrivateSpanChange[] => {
  const was = before.activePrep;
  const is = after.activePrep;
  const prepClosed = was !== null && was.startedAtMs !== is?.startedAtMs;
  const prepOpened = is !== null && is.startedAtMs !== was?.startedAtMs;
  const judgingWas = before.stage === 'awaiting_ballot';
  const judgingIs = after.stage === 'awaiting_ballot';
  const used = was ? after.consumedNowMs - was.consumedMs : 0;
  return [
    ...(prepClosed
      ? [
          {
            type: 'close' as const,
            kind: 'prep' as const,
            atMs: used > 0 ? Math.min(nowMs, was.startedAtMs + used) : nowMs,
          },
        ]
      : []),
    ...(prepOpened
      ? [{ type: 'open' as const, kind: 'prep' as const, atMs: is.startedAtMs }]
      : []),
    ...(judgingIs && !judgingWas
      ? [
          {
            type: 'open' as const,
            kind: 'judging' as const,
            atMs: finalSegmentEndedAtMs ?? nowMs,
          },
        ]
      : []),
    ...(judgingWas && !judgingIs
      ? [{ type: 'close' as const, kind: 'judging' as const, atMs: nowMs }]
      : []),
  ];
};

/**
 * What a failed Recording's retained source may keep: only segments wholly inside
 * something committed history proved public. A straddler goes whole, since cutting it
 * would rewrite a source for a rebuild that may never come, and unknown means gone.
 */
export const wholeSegmentsInside = <T extends Captured>(
  entries: readonly T[],
  intervals: readonly PublicInterval[],
): readonly T[] =>
  entries.filter((entry) =>
    intervals.some(
      ({ fromMs, toMs }) =>
        fromMs <= entry.capturedAtMs &&
        entry.capturedAtMs + entry.durationMs <= toMs,
    ),
  );
