import type { PublicInterval } from '@daisy/protocol';

/** One Egress attempt whose media could be read, with its place in real time. */
export type CapturedPiece = {
  readonly attempt: number;
  readonly path: string;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly hasAudio: boolean;
};

export type TimelinePart =
  | { readonly kind: 'media'; readonly piece: CapturedPiece }
  | { readonly kind: 'gap'; readonly durationMs: number };

export type Coverage = {
  readonly capturedFromMs: number;
  readonly durationMs: number;
  readonly parts: readonly TimelinePart[];
  readonly gaps: readonly {
    readonly startMs: number;
    readonly endMs: number;
    readonly reason: 'capture_restart' | 'not_public';
  }[];
};

/** Below this a restart cannot be seen, and a slate would only be a flash. */
const SHORTEST_GAP_MS = 250;
/** A piece's probed length is not exact to the millisecond. */
const PIECE_TOLERANCE_MS = 100;

/**
 * The whole video from the attempts that left media, in attempt order. Video time
 * follows real time: the stretch between two attempts is a stretch of the video,
 * stated as a gap, so a Recording never pretends to be continuous. Null when no
 * attempt left anything. Clocks can disagree, so an attempt that seems to start
 * before the last ended just follows it.
 */
export const coverageOf = (
  pieces: readonly CapturedPiece[],
  intervals: readonly PublicInterval[],
): Coverage | null => {
  const ordered = [...pieces].sort((x, y) => x.attempt - y.attempt);
  const [first] = ordered;
  if (!first) return null;
  const parts: TimelinePart[] = [];
  const gaps: Coverage['gaps'][number][] = [];
  let cursorMs = 0;
  for (const piece of ordered) {
    const realMs = piece.startedAtMs - first.startedAtMs;
    if (realMs - cursorMs >= SHORTEST_GAP_MS) {
      gaps.push({
        startMs: cursorMs,
        endMs: realMs,
        // Inside one public interval only a restart can explain it.
        reason: intervals.some(
          ({ fromMs, toMs }) =>
            fromMs <= first.startedAtMs + cursorMs + PIECE_TOLERANCE_MS &&
            toMs + PIECE_TOLERANCE_MS >= piece.startedAtMs,
        )
          ? 'capture_restart'
          : 'not_public',
      });
      parts.push({ kind: 'gap', durationMs: realMs - cursorMs });
      cursorMs = realMs;
    }
    parts.push({ kind: 'media', piece });
    cursorMs += piece.durationMs;
  }
  return {
    capturedFromMs: first.startedAtMs,
    durationMs: cursorMs,
    parts,
    gaps,
  };
};
