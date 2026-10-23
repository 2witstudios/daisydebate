import { CAPTURE_HISTORY_READ_MS } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import type { createMediaWorkerClient } from '@daisy/media/worker';
export type CaptureClient = ReturnType<typeof createMediaWorkerClient>;
export type CaptureState = Awaited<ReturnType<CaptureClient['read']>>['state'];
export type Window = { readonly beforeMs: number; readonly afterMs: number };
/** Cached authority is only a staging filter; fresh PG horizon is checked separately. */
export function contained(state: CaptureState, seat: string, window: Window) {
  const segment = state.segment;
  if (
    !segment ||
    window.beforeMs < Date.parse(segment.startedAt) ||
    window.afterMs >=
      Math.min(
        segment.endedAt === null ? Infinity : Date.parse(segment.endedAt),
        Date.parse(segment.startedAt) + segment.durationMs,
      )
  )
    return false;
  return (
    state.intervals.filter(
      (i) =>
        i.roundParticipantId === seat &&
        Date.parse(i.startedAt) <= window.beforeMs &&
        (i.endedAt === null || window.afterMs < Date.parse(i.endedAt)),
    ).length === 1
  );
}
/** A calibrated 10 ms frame: its nominal start and server-time bracket. */
export type FrameWindow = Window & { readonly nominalStartMs: number };
const straddles = (frame: Window, edgeMs: number) =>
  frame.beforeMs < edgeMs && edgeMs <= frame.afterMs;

/** Whether a frame's bracket crosses a start or end of one of the seat's grants. */
export function straddlesGrantEdge(
  state: CaptureState,
  seat: string,
  frame: Window,
) {
  return state.intervals.some(
    (i) =>
      i.roundParticipantId === seat &&
      (straddles(frame, Date.parse(i.startedAt)) ||
        (i.endedAt !== null && straddles(frame, Date.parse(i.endedAt)))),
  );
}

/**
 * The window a transcribed clip proves the worker captured: the nominal span
 * of its frames, which advance exactly 10 ms per received frame, so any missing
 * frame between clips leaves a gap (brackets are wider than a frame and would
 * bridge short dropouts; ISSUE-466-r3). Frames straddling a grant edge are
 * refused by contained(), so a clip alone never reaches the edge; it extends to
 * an edge only when a frame contiguous with it on the same track (nominal
 * ±10 ms) straddled that edge. A late join, an early drop or a gap just inside
 * the edge keeps the nominal span, so the stream stays partial.
 */
export function observedWindow(input: {
  readonly clip: {
    readonly firstNominalMs: number;
    readonly lastNominalMs: number;
  };
  readonly grant: { readonly startMs: number; readonly endMs: number | null };
  readonly straddles: readonly FrameWindow[];
}): { readonly fromMs: number; readonly untilMs: number } {
  const { clip, grant } = input;
  const startEvidence = input.straddles.some(
    (frame) =>
      frame.nominalStartMs === clip.firstNominalMs - 10 &&
      straddles(frame, grant.startMs),
  );
  const endEvidence =
    grant.endMs !== null &&
    input.straddles.some(
      (frame) =>
        frame.nominalStartMs === clip.lastNominalMs + 10 &&
        straddles(frame, grant.endMs!),
    );
  return {
    fromMs: startEvidence ? grant.startMs : clip.firstNominalMs,
    untilMs: endEvidence ? grant.endMs! : clip.lastNominalMs + 10,
  };
}
export async function readCaptureHistory(
  client: CaptureClient,
  epoch: number,
  signal: AbortSignal,
  segmentId?: string,
) {
  signal = AbortSignal.any([
    signal,
    AbortSignal.timeout(CAPTURE_HISTORY_READ_MS),
  ]);
  const first = await client.read(
    { epoch, ...(segmentId ? { segmentId } : {}) },
    signal,
  );
  let cursor = first.state.nextIntervalId;
  const intervals = [...first.state.intervals];
  while (cursor) {
    signal.throwIfAborted();
    const next = await client.read(
      {
        epoch,
        segmentId: first.state.segment!.id,
        expectedVersion: first.state.version,
        afterIntervalId: cursor,
      },
      signal,
    );
    intervals.push(...next.state.intervals);
    if (intervals.length > 16384)
      throw createAppError(
        'INFRASTRUCTURE',
        'Capture history exceeds resource bound',
      );
    cursor = next.state.nextIntervalId;
  }
  return { ...first, state: { ...first.state, intervals } };
}
