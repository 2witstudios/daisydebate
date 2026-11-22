import { instantMs } from '@daisy/clock';
import { CAPTURE_HISTORY_READ_MS } from '@daisy/protocol/capture-timing';
import { speakingEndMs } from '@daisy/protocol/segment-end';
import { CAPTURE_OUTAGE_BUDGET_MS } from './capture-memory';
import { createAppError } from '@daisy/errors';
import {
  isDefiniteRefusal,
  isTransientControlFailure,
} from '@daisy/media/worker';
import type { createMediaWorkerClient } from '@daisy/media/worker';
export type CaptureClient = ReturnType<typeof createMediaWorkerClient>;
export type CaptureState = Awaited<ReturnType<CaptureClient['read']>>['state'];
export type Window = { readonly beforeMs: number; readonly afterMs: number };
export type CaptureGrant = CaptureState['intervals'][number];
/** The segment and the one grant of the seat that hold the window; null when none does. */
export function containingGrant(
  state: CaptureState,
  seat: string,
  window: Window,
) {
  const segment = state.segment;
  if (
    !segment ||
    window.beforeMs < instantMs(segment.startedAt) ||
    window.afterMs >=
      speakingEndMs({
        startedAtMs: instantMs(segment.startedAt),
        endedAtMs: segment.endedAt === null ? null : instantMs(segment.endedAt),
        durationMs: segment.durationMs,
        returnedMs: segment.returnedMs,
      })
  )
    return null;
  const [grant, ...others] = state.intervals.filter(
    (i) =>
      i.roundParticipantId === seat &&
      instantMs(i.startedAt) <= window.beforeMs &&
      (i.endedAt === null || window.afterMs < instantMs(i.endedAt)),
  );
  return grant !== undefined && others.length === 0 ? { segment, grant } : null;
}
/** Cached authority is only a staging filter; fresh PG horizon is checked separately. */
export function contained(state: CaptureState, seat: string, window: Window) {
  return containingGrant(state, seat, window) !== null;
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
      (straddles(frame, instantMs(i.startedAt)) ||
        (i.endedAt !== null && straddles(frame, instantMs(i.endedAt)))),
  );
}

/**
 * The window a transcribed clip proves the worker captured: the nominal span
 * of its frames, which advance exactly 10 ms per sequence number, so any missing
 * frame between clips leaves a gap (DEC-215) (brackets are wider than a frame and would
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
  const { endMs } = grant;
  const endEvidence =
    endMs !== null &&
    input.straddles.some(
      (frame) =>
        frame.nominalStartMs === clip.lastNominalMs + 10 &&
        straddles(frame, endMs),
    );
  return {
    fromMs: startEvidence ? grant.startMs : clip.firstNominalMs,
    untilMs: endEvidence ? endMs : clip.lastNominalMs + 10,
  };
}
/** How long a read the control plane could not answer waits before its restart. */
const READ_RETRY_MS = 250;
/** The session's injected time, for pausing and for the outage budget. */
export type CapturePace = {
  readonly nowMs: () => number;
  readonly waitUntilMs: (due: number, signal: AbortSignal) => Promise<void>;
};
/** The worker's own pause: until `performance.now()` reaches `due`, or `signal` aborts. */
export async function waitUntilPerformanceMs(due: number, signal: AbortSignal) {
  while (performance.now() < due && !signal.aborted)
    await Bun.sleep(Math.max(1, Math.min(25, due - performance.now())));
}
/**
 * A timed-out acquisition or an unanswering control plane is not an authority
 * refusal; restart with no partial pages, while frames wait in staging. Still
 * unanswered at the outage budget, the last failure ends the read.
 */
export async function readCaptureHistory(
  client: Pick<CaptureClient, 'read'>,
  epoch: number,
  signal: AbortSignal,
  pace: CapturePace,
  segmentId?: string,
  options: { readonly deadlineSignal?: () => AbortSignal } = {},
) {
  const giveUpAt = pace.nowMs() + CAPTURE_OUTAGE_BUDGET_MS;
  for (;;) {
    signal.throwIfAborted();
    const deadline =
      options.deadlineSignal?.() ??
      AbortSignal.timeout(CAPTURE_HISTORY_READ_MS);
    try {
      const snapshot = await readSnapshot(
        client,
        epoch,
        AbortSignal.any([signal, deadline]),
        segmentId,
      );
      signal.throwIfAborted();
      if (!deadline.aborted) return snapshot;
      if (pace.nowMs() >= giveUpAt)
        throw createAppError('INFRASTRUCTURE', 'Capture history stayed late');
    } catch (error) {
      // A caller abort or server answer still ends capture immediately.
      if (signal.aborted || isDefiniteRefusal(error)) throw error;
      if (pace.nowMs() >= giveUpAt) throw error;
      if (deadline.aborted) continue;
      if (!isTransientControlFailure(error)) throw error;
      await pace.waitUntilMs(pace.nowMs() + READ_RETRY_MS, signal);
    }
  }
}

async function readSnapshot(
  client: Pick<CaptureClient, 'read'>,
  epoch: number,
  signal: AbortSignal,
  segmentId?: string,
) {
  const first = await client.read(
    { epoch, ...(segmentId ? { segmentId } : {}) },
    signal,
  );
  let cursor = first.state.nextIntervalId;
  const intervals = [...first.state.intervals];
  const pagedSegment = first.state.segment;
  while (cursor) {
    // The server pages only a segment's intervals: no segment, no next page.
    if (pagedSegment === null)
      throw new Error('Capture history paged intervals without a segment');
    signal.throwIfAborted();
    const next = await client.read(
      {
        epoch,
        segmentId: pagedSegment.id,
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
