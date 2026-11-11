import {
  startEdgeLagMs,
  type CoverageGap,
  type RecordingMedia,
} from '@daisy/protocol';
import { outsideGaps } from './speech-timeline';

type Unrecorded = NonNullable<RecordingMedia['unrecorded']>[number];

/** The Round's own record, read as a named input, of what happened when. */
export type RoundCoverageFacts = {
  /** Its public segments, in order. */
  readonly segments: readonly {
    readonly startedAtMs: number;
    readonly endedAtMs: number | null;
  }[];
  /** Each private prep began here, and runs until the next segment starts. */
  readonly prepStartsAtMs: readonly number[];
  readonly rotationsAtMs: readonly number[];
};

/** Below this, a stretch is clock disagreement, not something a viewer missed. */
const SHORTEST_STATED_MS = 1000;

/**
 * How long a rotation is stated to cost. The stage notices on its next one second
 * poll and rejoins, and debaters follow on their own reconcile. No one records the
 * end of it, so this is a stated estimate, not a measurement.
 */
export const ROOM_ROTATION_DROPOUT_MS = 5000;

/**
 * The first public clip opens after the first speech by design (the public interval's
 * start margin) and the encoder cuts near the last one's end, about a second each
 * way as measured on staging. Debate lost at either end is stated only beyond this.
 */
const EDGE_OF_SPEECH_MS = 2500;

/**
 * A speech's public clip opens past its start by the start-edge stamp lag (ADR 0099),
 * which grows with the capture's age. The publisher counts that age from when the
 * capture was opened, before its first frame, so the lag it used can exceed the one
 * computed here from the first frame. This slack covers that, the worker's 100 ms
 * piece tolerance and a probe's error. With no age the opening is 2.5 s, the same
 * as `EDGE_OF_SPEECH_MS`.
 */
const OPENING_SLACK_MS = 1200;

const NEVER_MS = Number.MAX_SAFE_INTEGER;

type Span = { readonly startMs: number; readonly endMs: number };

/** Real-time stretches the stage shows its slate: all but the public segments. */
const privateStretches = ({
  segments,
  prepStartsAtMs,
}: RoundCoverageFacts): readonly Span[] => {
  const [first] = segments;
  const last = segments.at(-1);
  if (!first || !last) return [];
  const startOfNext = (atMs: number) =>
    segments.find((segment) => segment.startedAtMs >= atMs)?.startedAtMs ??
    NEVER_MS;
  return [
    { startMs: 0, endMs: first.startedAtMs },
    ...prepStartsAtMs.map((atMs) => ({
      startMs: atMs,
      endMs: startOfNext(atMs),
    })),
    ...(last.endedAtMs === null
      ? []
      : [{ startMs: last.endedAtMs, endMs: NEVER_MS }]),
  ];
};

/** Pieces of a span inside any window, and the rest of it. */
const split = (span: Span, windows: readonly Span[]) => {
  const outside = outsideGaps(span, windows);
  return { inside: outsideGaps(span, outside), outside };
};

/**
 * A slate window, where the speech after it starts, and where it may reach back to:
 * into the speech it directly follows, or nowhere.
 */
type Window = Span & {
  readonly nextStartMs: number;
  readonly reachesBackToMs: number;
};

/**
 * Where the stage showed its slate by design, as committed history says: each
 * private stretch a committed segment follows, and each turnover from a closed
 * segment's end to the next one's opening. Nothing without a committed segment after
 * it is a window, so an open segment, or time after the last, explains nothing: it
 * fails closed.
 */
const slateWindows = (facts: RoundCoverageFacts, capturedFromMs: number) => {
  const { segments } = facts;
  /**
   * Only a window that starts as a speech ends, within clock disagreement, reaches
   * into it. A prep that starts after a turnover leaves that closing to the turnover.
   */
  const reachBack = (atMs: number) => {
    const endedMs = segments
      .map((segment) => segment.endedAtMs)
      .filter(
        (endMs): endMs is number =>
          endMs !== null && endMs <= atMs && atMs - endMs < SHORTEST_STATED_MS,
      )
      .at(-1);
    return endedMs === undefined ? atMs : endedMs - EDGE_OF_SPEECH_MS;
  };
  const window = (startMs: number, nextStartMs: number): Window => ({
    startMs,
    nextStartMs,
    reachesBackToMs: reachBack(startMs),
    endMs:
      nextStartMs +
      startEdgeLagMs(nextStartMs, capturedFromMs) +
      OPENING_SLACK_MS,
  });
  return {
    private: privateStretches(facts)
      .filter((span) => span.endMs !== NEVER_MS)
      .map((span) => window(span.startMs, span.endMs)),
    between: segments.flatMap((segment, index) => {
      const next = segments[index + 1];
      return next && segment.endedAtMs !== null
        ? [window(segment.endedAtMs, next.startedAtMs)]
        : [];
    }),
  };
};

/**
 * The windows as one gap may use them, in video time. Public media stops short of a
 * speech's end (the encoder cuts near it, and 700 ms before a prep), so a window
 * that follows a speech reaches back `EDGE_OF_SPEECH_MS` into it, but only for a gap
 * that runs on into the slate. It runs on through the next speech's opening only for a
 * gap that reaches it from before that speech, to within clock disagreement: speeches
 * can run back to back, and a probed piece ends a few milliseconds off. A gap that
 * stays inside a speech touches no slate, and is lost however near its edge it is.
 */
const windowsFor = (
  gap: Span,
  windows: readonly Window[],
  capturedFromMs: number,
): readonly Span[] =>
  windows
    .map((window) => {
      const startMs = window.startMs - capturedFromMs;
      const nextStartMs = window.nextStartMs - capturedFromMs;
      return {
        startMs:
          gap.endMs > startMs
            ? Math.min(startMs, window.reachesBackToMs - capturedFromMs)
            : startMs,
        endMs:
          gap.startMs < nextStartMs + SHORTEST_STATED_MS
            ? window.endMs - capturedFromMs
            : nextStartMs,
      };
    })
    // Clocks can disagree enough to turn a window inside out; it explains nothing.
    .filter((window) => window.endMs > window.startMs);

/**
 * The worker knows only what is not proven public. Against the Round's committed
 * record, each `not_public` gap's stretches inside a private phase are
 * `private_phase`, and those in a turnover are `between_speeches`: neither is
 * debate lost. What history does not explain stays `not_public`, and a sliver of
 * it under a second beside an explained stretch is clock disagreement, told with
 * that stretch. Every other reason stands. Touching stretches of one reason are
 * told once. Pure, total and stable: its own answer comes back unchanged.
 */
export const explainGaps = (
  gaps: readonly CoverageGap[],
  facts: RoundCoverageFacts,
  capturedFromMs: number,
): readonly CoverageGap[] => {
  const windows = slateWindows(facts, capturedFromMs);
  const explained = gaps.flatMap((gap): readonly CoverageGap[] => {
    if (gap.reason !== 'not_public') return [gap];
    const privately = split(
      gap,
      windowsFor(gap, windows.private, capturedFromMs),
    );
    const between = privately.outside.map((span) =>
      split(span, windowsFor(gap, windows.between, capturedFromMs)),
    );
    const pieces: CoverageGap[] = [
      ...privately.inside.map((span) => ({
        ...span,
        reason: 'private_phase' as const,
      })),
      ...between.flatMap(({ inside }) =>
        inside.map((span) => ({
          ...span,
          reason: 'between_speeches' as const,
        })),
      ),
      ...between.flatMap(({ outside }) =>
        outside.map((span) => ({ ...span, reason: 'not_public' as const })),
      ),
    ].sort((x, y) => x.startMs - y.startMs);
    return pieces.map((piece, index) => {
      if (
        piece.reason !== 'not_public' ||
        piece.endMs - piece.startMs >= SHORTEST_STATED_MS
      )
        return piece;
      const beside = [pieces[index - 1], pieces[index + 1]].find(
        (other) => other && other.reason !== 'not_public',
      );
      return beside ? { ...piece, reason: beside.reason } : piece;
    });
  });
  return [...explained]
    .sort((x, y) => x.startMs - y.startMs)
    .reduce<CoverageGap[]>((told, gap) => {
      const last = told.at(-1);
      if (last && last.reason === gap.reason && gap.startMs <= last.endMs)
        told[told.length - 1] = {
          ...last,
          endMs: Math.max(last.endMs, gap.endMs),
        };
      else told.push(gap);
      return told;
    }, []);
};

/**
 * What a finished video does not hold, stated against the Round's own record.
 * The worker's gaps come first; a dropout or a private phase is stated only where
 * none already covers it, so no moment is told twice, and the worker's
 * `not_public` stretches are then explained (`explainGaps`). Debate before the
 * first frame or after the last has no place in the video, so it is stated apart.
 * Pure and total.
 */
export const coverageStatement = ({
  facts,
  capture,
  broadcastStopped,
}: {
  readonly facts: RoundCoverageFacts;
  readonly capture: {
    readonly startedAtMs: number;
    readonly durationMs: number;
    readonly restartGaps: readonly CoverageGap[];
  };
  readonly broadcastStopped: boolean;
}): {
  readonly gaps: readonly CoverageGap[];
  readonly unrecorded: readonly Unrecorded[];
} => {
  const { startedAtMs, durationMs, restartGaps } = capture;
  const gaps: CoverageGap[] = [...restartGaps];
  const state = (real: readonly Span[], reason: CoverageGap['reason']) => {
    const inVideo = real
      .map((span) => ({
        startMs: Math.max(0, span.startMs - startedAtMs),
        endMs: Math.min(durationMs, span.endMs - startedAtMs),
      }))
      .filter((span) => span.endMs > span.startMs)
      .flatMap((span) => outsideGaps(span, gaps))
      .filter((span) => span.endMs - span.startMs >= SHORTEST_STATED_MS);
    gaps.push(...inVideo.map((span) => ({ ...span, reason })));
  };
  state(
    facts.rotationsAtMs.map((atMs) => ({
      startMs: atMs,
      endMs: atMs + ROOM_ROTATION_DROPOUT_MS,
    })),
    'room_rotation',
  );
  state(privateStretches(facts), 'private_phase');

  const first = facts.segments[0];
  const last = facts.segments.at(-1);
  const debateEndMs = last ? (last.endedAtMs ?? last.startedAtMs) : null;
  const missedAtStart = first ? startedAtMs - first.startedAtMs : 0;
  const missedAtEnd =
    debateEndMs === null ? 0 : debateEndMs - (startedAtMs + durationMs);
  return {
    gaps: explainGaps(gaps, facts, startedAtMs),
    unrecorded: [
      ...(missedAtStart >= EDGE_OF_SPEECH_MS
        ? [
            {
              part: 'start',
              durationMs: missedAtStart,
              reason: 'late_start',
            } as const,
          ]
        : []),
      ...(missedAtEnd >= EDGE_OF_SPEECH_MS
        ? [
            {
              part: 'end',
              durationMs: missedAtEnd,
              reason: broadcastStopped ? 'broadcast_stopped' : 'ended_early',
            } as const,
          ]
        : []),
    ],
  };
};

/**
 * What each reason means to a viewer, sorted once, so a new reason cannot compile
 * until it is placed: debate lost, kept private by design, or the slate between
 * speeches, which holds no debate.
 */
const GAP_KIND = {
  capture_restart: 'lost',
  room_rotation: 'lost',
  not_public: 'lost',
  private_phase: 'private',
  between_speeches: 'slate',
} as const satisfies Record<
  CoverageGap['reason'],
  'lost' | 'private' | 'slate'
>;

type ReasonOf<K> = {
  [R in keyof typeof GAP_KIND]: (typeof GAP_KIND)[R] extends K ? R : never;
}[keyof typeof GAP_KIND];

/** Debate that happened and is not in the video. */
export type LostGap = CoverageGap & { readonly reason: ReasonOf<'lost'> };
/** A stretch withheld by design. */
export type PrivateGap = CoverageGap & { readonly reason: ReasonOf<'private'> };

/**
 * A video's gaps as a viewer is told them: what was lost, and what was kept private.
 * The slate between speeches is neither, so it is not told.
 */
export const coverageParts = (
  gaps: readonly CoverageGap[],
): {
  readonly lost: readonly LostGap[];
  readonly keptPrivate: readonly PrivateGap[];
} => ({
  lost: gaps.filter((gap): gap is LostGap => GAP_KIND[gap.reason] === 'lost'),
  keptPrivate: gaps.filter(
    (gap): gap is PrivateGap => GAP_KIND[gap.reason] === 'private',
  ),
});
