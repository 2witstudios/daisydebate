import { startEdgeLagMs, type RecordingMedia } from '@daisy/protocol';
import { outsideGaps } from './speech-timeline';

type Gap = RecordingMedia['gaps'][number];
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

/** A slate window, and where the speech after it starts. */
type Window = Span & { readonly nextStartMs: number };

/**
 * Where the stage showed its slate by design, as committed history says: each
 * private stretch a committed segment follows, and each turnover from a closed
 * segment's end to the next one's opening. Nothing without a committed segment after
 * it is a window, so an open segment, or time after the last, explains nothing: it
 * fails closed.
 */
const slateWindows = (facts: RoundCoverageFacts, capturedFromMs: number) => {
  const window = (startMs: number, nextStartMs: number): Window => ({
    startMs,
    nextStartMs,
    endMs:
      nextStartMs +
      startEdgeLagMs(nextStartMs, capturedFromMs) +
      OPENING_SLACK_MS,
  });
  const { segments } = facts;
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
 * The windows as one gap may use them, in video time. A window runs on through the
 * next speech's opening only for a gap that reaches it from before that speech, to
 * within clock disagreement: speeches can run back to back, and a probed piece ends
 * a few milliseconds off. A gap that opens later inside a speech touches no slate,
 * and is lost however early it is.
 */
const windowsFor = (
  gap: Span,
  windows: readonly Window[],
  capturedFromMs: number,
): readonly Span[] =>
  windows.map((window) => {
    const nextStartMs = window.nextStartMs - capturedFromMs;
    return {
      startMs: window.startMs - capturedFromMs,
      endMs:
        gap.startMs < nextStartMs + SHORTEST_STATED_MS
          ? window.endMs - capturedFromMs
          : nextStartMs,
    };
  });

/**
 * The worker knows only what is not proven public. Against the Round's committed
 * record, each `not_public` gap's stretches inside a private phase are
 * `private_phase`, and those in a turnover are `between_speeches`: neither is
 * debate lost. What history does not explain stays `not_public`, and a sliver of
 * it under a second beside an explained stretch is clock disagreement, told with
 * that stretch. Every other reason stands. Touching stretches of one reason are
 * told once. Pure, total and stable: its own answer comes back unchanged, so it
 * can state a Recording stored before it as well as a new one.
 */
export const explainGaps = (
  gaps: readonly Gap[],
  facts: RoundCoverageFacts,
  capturedFromMs: number,
): readonly Gap[] => {
  const windows = slateWindows(facts, capturedFromMs);
  const explained = gaps.flatMap((gap): readonly Gap[] => {
    if (gap.reason !== 'not_public') return [gap];
    const privately = split(
      gap,
      windowsFor(gap, windows.private, capturedFromMs),
    );
    const between = privately.outside.map((span) =>
      split(span, windowsFor(gap, windows.between, capturedFromMs)),
    );
    const pieces: Gap[] = [
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
    .reduce<Gap[]>((told, gap) => {
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
    readonly restartGaps: readonly Gap[];
  };
  readonly broadcastStopped: boolean;
}): {
  readonly gaps: readonly Gap[];
  readonly unrecorded: readonly Unrecorded[];
} => {
  const { startedAtMs, durationMs, restartGaps } = capture;
  const gaps: Gap[] = [...restartGaps];
  const state = (real: readonly Span[], reason: Gap['reason']) => {
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
