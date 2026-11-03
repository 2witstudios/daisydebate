import { publicClips, type PublicInterval } from '@daisy/protocol';
import type { CapturedPiece } from './coverage';

/** A piece's public part, as it goes into a POV's one encode. */
export type PovClip = {
  readonly path: string;
  readonly offsetMs: number;
  readonly durationMs: number;
  readonly hasAudio: boolean;
};

export type PovTimelinePart =
  | { readonly kind: 'media'; readonly clip: PovClip }
  | { readonly kind: 'gap'; readonly durationMs: number };

export type PovTimeline = {
  readonly parts: readonly PovTimelinePart[];
  readonly gaps: readonly {
    readonly startMs: number;
    readonly endMs: number;
    readonly reason: 'not_public' | 'capture_restart';
  }[];
};

/** Less than one frame shows nothing and an encoder may drop it. */
const SHORTEST_PART_MS = 40;

/**
 * One debater's view on the composite's own timeline, so the two line up in an editor:
 * the same first instant, the same length, and slate wherever this view has nothing.
 * Only what the public-interval gate passes is used, so a stretch that is not known
 * to be public has no way in. Null when nothing of it is public.
 */
export const povTimeline = (
  pieces: readonly CapturedPiece[],
  intervals: readonly PublicInterval[],
  frame: { readonly fromMs: number; readonly durationMs: number },
): PovTimeline | null => {
  const clips = [
    ...publicClips(
      pieces.map((piece) => ({
        piece,
        capturedAtMs: piece.startedAtMs,
        durationMs: piece.durationMs,
      })),
      intervals,
    ),
  ].sort((a, b) => a.capturedAtMs - b.capturedAtMs);
  const parts: PovTimelinePart[] = [];
  const gaps: PovTimeline['gaps'][number][] = [];
  let cursorMs = 0;
  const addGap = (endMs: number) => {
    const fromMs = frame.fromMs + cursorMs;
    const toMs = frame.fromMs + endMs;
    gaps.push({
      startMs: cursorMs,
      endMs,
      // Inside one public interval only a restart can explain it.
      reason: intervals.some((i) => i.fromMs <= fromMs && i.toMs >= toMs)
        ? 'capture_restart'
        : 'not_public',
    });
    parts.push({ kind: 'gap', durationMs: endMs - cursorMs });
    cursorMs = endMs;
  };
  for (const clip of clips) {
    const realMs = clip.capturedAtMs - frame.fromMs;
    // Attempts can overlap and a view can outrun the composite: never twice, never past.
    const startMs = Math.max(realMs, cursorMs);
    const endMs = Math.min(realMs + clip.durationMs, frame.durationMs);
    if (endMs - startMs < SHORTEST_PART_MS) continue;
    if (startMs - cursorMs >= SHORTEST_PART_MS) addGap(startMs);
    parts.push({
      kind: 'media',
      clip: {
        path: clip.source.piece.path,
        offsetMs: clip.offsetMs + (startMs - realMs),
        durationMs: endMs - startMs,
        hasAudio: clip.source.piece.hasAudio,
      },
    });
    cursorMs = endMs;
  }
  if (parts.length === 0) return null;
  if (frame.durationMs - cursorMs >= SHORTEST_PART_MS) addGap(frame.durationMs);
  return { parts, gaps };
};
