import type { RecordingMedia, RecordingSpeech } from '@daisy/protocol';

/** An accepted floor interval, read from the Round as a named, read-only input. */
export type FloorInterval = {
  readonly roundParticipantId: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number | null;
};

type Span = { readonly startMs: number; readonly endMs: number };

/** What of a span survives once the stretches no media covers are taken out. */
export const outsideGaps = (
  span: Span,
  gaps: readonly Span[],
): readonly Span[] => {
  const spans: Span[] = [];
  let cursor = span.startMs;
  for (const gap of [...gaps].sort((x, y) => x.startMs - y.startMs)) {
    if (gap.endMs <= cursor || gap.startMs >= span.endMs) continue;
    if (gap.startMs > cursor)
      spans.push({ startMs: cursor, endMs: gap.startMs });
    cursor = Math.max(cursor, gap.endMs);
  }
  if (cursor < span.endMs) spans.push({ startMs: cursor, endMs: span.endMs });
  return spans;
};

/**
 * Who spoke when, in video time. Clipped to what the capture covers: a turn that
 * ended before capture began never appears, one still open at the end of capture
 * runs to the end of the video, and a stretch inside a gap is not claimed, so
 * no marker leads to a moment the video does not hold.
 */
export const speechTimeline = (
  intervals: readonly FloorInterval[],
  capture: {
    readonly startedAtMs: number;
    readonly durationMs: number;
    readonly gaps: readonly Span[];
  },
): readonly RecordingSpeech[] =>
  intervals
    .flatMap(({ roundParticipantId, startedAtMs, endedAtMs }) =>
      outsideGaps(
        {
          startMs: Math.max(0, startedAtMs - capture.startedAtMs),
          endMs: Math.min(
            capture.durationMs,
            (endedAtMs ?? capture.startedAtMs + capture.durationMs) -
              capture.startedAtMs,
          ),
        },
        capture.gaps,
      ).map((span) => ({ roundParticipantId, ...span })),
    )
    .filter((speech) => speech.endMs > speech.startMs)
    .sort(
      (x, y) =>
        x.startMs - y.startMs ||
        x.roundParticipantId.localeCompare(y.roundParticipantId),
    );

/** What media derived from a Recording records about where it came from. */
export type DerivedMediaSource = {
  readonly recordingId: string;
  readonly roundId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly roundParticipantIds: readonly string[];
};

/**
 * The provenance of one time range of a Recording, or null for a range the
 * video does not hold. Whoever speaks in the range appears in it.
 */
export const derivedMediaSource = (
  recording: { readonly id: string; readonly roundId: string },
  media: Pick<RecordingMedia, 'durationMs' | 'speeches'>,
  range: { readonly startMs: number; readonly endMs: number },
): DerivedMediaSource | null => {
  if (
    range.startMs < 0 ||
    range.endMs <= range.startMs ||
    range.endMs > media.durationMs
  )
    return null;
  const appearing = media.speeches
    .filter(
      (speech) => speech.startMs < range.endMs && speech.endMs > range.startMs,
    )
    .map((speech) => speech.roundParticipantId);
  return {
    recordingId: recording.id,
    roundId: recording.roundId,
    startMs: range.startMs,
    endMs: range.endMs,
    roundParticipantIds: [...new Set(appearing)].sort((x, y) =>
      x.localeCompare(y),
    ),
  };
};
