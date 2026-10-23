import type { cutCaptureClips } from '@daisy/media/clips';
import { flushClipCarry, type ClipCarries } from './capture-batch';

/** The common cleanup budget: the drain and the fallback seal together. */
const CAPTURE_CLEANUP_BUDGET_MS = 10_000;
/** The part of the budget kept for the fallback seal after a drain. */
const SEAL_RESERVE_MS = 2_000;
type Clip = ReturnType<typeof cutCaptureClips>['clips'][number];

/**
 * Ends a capture session (VIDEO-4.1-r12). On a graceful stop (the caller's
 * abort: a deploy or restart, never a capture-closed refusal or a lost
 * lease) every open carry is flushed as a final clip and the still-running
 * consumer drains the queue, until nothing is in flight or the budget leaves
 * only the seal's reserve. Otherwise the carries' frames are dropped. Either
 * way the consumer then halts, what is left in the queue is dropped, and the
 * fallback seal runs: a stream whose clips never reached a chunk seals
 * honestly partial (DEC-208), never with its loss unrecorded.
 */
export async function closeCaptureSession(input: {
  readonly graceful: boolean;
  readonly carries: ClipCarries;
  readonly roundId: string;
  readonly enqueue: (clip: Clip) => void;
  /** Clips queued or still being transcribed. */
  readonly inFlight: () => number;
  readonly halt: () => void;
  readonly consuming: Promise<unknown>;
  /** Empties the queue; returns its frames. */
  readonly discardQueued: () => number;
  readonly dropped: (frames: number) => void;
  readonly seal: (signal: AbortSignal) => Promise<number>;
  readonly nowMs: () => number;
  readonly waitUntilMs: (due: number, signal: AbortSignal) => Promise<void>;
}) {
  const cleanup = AbortSignal.timeout(CAPTURE_CLEANUP_BUDGET_MS);
  const drainUntil =
    input.nowMs() + CAPTURE_CLEANUP_BUDGET_MS - SEAL_RESERVE_MS;
  for (const [key, carry] of input.carries) {
    if (input.graceful) {
      const [segmentId, roundParticipantId] = JSON.parse(key) as [
        string,
        string,
      ];
      flushClipCarry(input.carries, input.roundId, {
        segmentId,
        roundParticipantId,
      }).forEach(input.enqueue);
    } else input.dropped(carry.frames.length);
  }
  input.carries.clear();
  while (
    input.graceful &&
    input.inFlight() > 0 &&
    input.nowMs() < drainUntil &&
    !cleanup.aborted
  )
    await input
      .waitUntilMs(Math.min(input.nowMs() + 25, drainUntil), cleanup)
      .catch(() => undefined);
  input.halt();
  await input.consuming;
  input.dropped(input.discardQueued());
  return input.seal(cleanup);
}
