import { z } from 'zod';

/** Capture time in which the stage is known to have shown public speech. */
const publicIntervalSchema = z.strictObject({
  fromMs: z.int().nonnegative(),
  toMs: z.int().nonnegative(),
});
export const publicIntervalsSchema = z.array(publicIntervalSchema).max(10_000);
export type PublicInterval = z.infer<typeof publicIntervalSchema>;

/**
 * Egress stamps media later than it was made, and by how much depends on the attempt.
 * Measured on staging over 10 attempts: audio +52 to +890 ms, video +42 to +825, with
 * audio rising about 4 ms a minute. A clock difference between web and Egress adds to
 * this. Both values are provisional, until an 80 minute scan reports.
 *
 * A start waits the most the stamp can lag, plus the slope to 80 minutes, because
 * private media made before it can carry a stamp this late. This costs up to about
 * 400 ms of public speech at each start.
 */
const START_EDGE_STAMP_LAG_MS = 1200;
/**
 * An end takes the least, and one attempt reached about +50, so none is counted on:
 * every stamp at or after the end may be private, and none before it can be. This costs
 * about 800 ms of public speech at each end on a typical attempt.
 */
const END_EDGE_STAMP_LAG_MS = 0;

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
): readonly PublicInterval[] =>
  segments
    .map((segment) => ({
      fromMs: segment.startedAtMs + START_EDGE_STAMP_LAG_MS,
      toMs:
        (segment.endedAtMs ??
          Math.min(
            segment.startedAtMs + segment.durationMs,
            knownThroughMs ?? segment.startedAtMs,
          )) + END_EDGE_STAMP_LAG_MS,
    }))
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
  entry.capturedAtMs + entry.durationMs + START_EDGE_STAMP_LAG_MS <=
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
   * its audio replaced by silence: mics are closed, and nothing can be heard. `private`
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
}): readonly StageInterval[] => {
  const known = history.knownThroughMs;
  const privates = history.privateSpans.map((span) => ({
    kind: 'private' as const,
    fromMs: span.startedAtMs + END_EDGE_STAMP_LAG_MS,
    toMs:
      span.endedAtMs === null
        ? (known ?? span.startedAtMs)
        : span.endedAtMs + START_EDGE_STAMP_LAG_MS,
  }));
  const speeches = publicIntervals(history.segments, known).map((interval) => ({
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
