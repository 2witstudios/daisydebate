import type { RecordingMedia } from '@daisy/protocol';
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

/**
 * What a finished video does not hold, stated against the Round's own record.
 * Capture restarts come from the worker and stand; a dropout or a private phase is
 * stated only where a restart does not already cover it, so no moment is told
 * twice. Debate before the first frame or after the last has no place in the video,
 * so it is stated apart. Pure and total.
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
    gaps: [...gaps].sort((x, y) => x.startMs - y.startMs),
    unrecorded: [
      ...(missedAtStart >= SHORTEST_STATED_MS
        ? [
            {
              part: 'start',
              durationMs: missedAtStart,
              reason: 'late_start',
            } as const,
          ]
        : []),
      ...(missedAtEnd >= SHORTEST_STATED_MS
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
