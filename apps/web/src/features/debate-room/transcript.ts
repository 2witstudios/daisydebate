import { formatClock as formatSeconds } from '../judge/clock';
import type { SpeechSlot } from './documents/documents';

export type TranscriptSegment = {
  readonly id: string;
  readonly speechId: string;
  readonly offsetMs: number;
  readonly text: string;
};

export type TranscriptSection = {
  readonly speech: SpeechSlot;
  readonly speakerName: string;
  readonly segments: readonly TranscriptSegment[];
};

/** Sections in speech order, segments by offset; speeches with no segments are dropped. */
export function groupTranscript(
  segments: readonly TranscriptSegment[],
  speeches: readonly SpeechSlot[],
  speakerName: (slot: SpeechSlot) => string,
): readonly TranscriptSection[] {
  return speeches.flatMap((speech) => {
    const own = segments
      .filter((segment) => segment.speechId === speech.id)
      .sort((a, b) => a.offsetMs - b.offsetMs);
    return own.length === 0
      ? []
      : [{ speech, speakerName: speakerName(speech), segments: own }];
  });
}

export function filterSections(
  sections: readonly TranscriptSection[],
  speechId: string,
): readonly TranscriptSection[] {
  return speechId === 'all'
    ? sections
    : sections.filter((section) => section.speech.id === speechId);
}

/** The last segment of the live speech, or null. */
export function liveSegmentId(
  sections: readonly TranscriptSection[],
  liveSpeechId: string | null,
): string | null {
  const live = sections.find((section) => section.speech.id === liveSpeechId);
  return live?.segments.at(-1)?.id ?? null;
}

/** Elapsed offset as "m:ss", rounded down; negatives clamp to 0:00. */
export function formatOffset(ms: number): string {
  return formatSeconds(ms / 1000);
}
