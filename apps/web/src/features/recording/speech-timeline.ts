import type { RecordingMedia, RecordingSpeech } from '@daisy/protocol';

/** An accepted floor interval, read from the Round as a named, read-only input. */
export type FloorInterval = {
  readonly roundParticipantId: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number | null;
};

/**
 * Who spoke when, in video time. Clipped to what the capture covers: a turn that
 * ended before capture began never appears, and one still open at the end of
 * capture runs to the end of the video.
 */
export const speechTimeline = (
  intervals: readonly FloorInterval[],
  capture: { readonly startedAtMs: number; readonly durationMs: number },
): readonly RecordingSpeech[] =>
  intervals
    .map((interval) => ({
      roundParticipantId: interval.roundParticipantId,
      startMs: Math.max(0, interval.startedAtMs - capture.startedAtMs),
      endMs: Math.min(
        capture.durationMs,
        (interval.endedAtMs ?? capture.startedAtMs + capture.durationMs) -
          capture.startedAtMs,
      ),
    }))
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
