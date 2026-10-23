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
