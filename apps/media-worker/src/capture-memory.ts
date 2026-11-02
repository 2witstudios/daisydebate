/**
 * The agreed control-plane outage (ADR 0094). Past it, whatever still gets no
 * answer ends the session or its clip, so a server that keeps failing the same
 * way reaches the logs and a relaunch instead of a silently stalled capture.
 */
export const CAPTURE_OUTAGE_BUDGET_MS = 120_000;
/** Everything pending across one worker: a 1 GB machine's share for held PCM. */
export const CAPTURE_PENDING_TOTAL_BYTES = 256 * 1024 * 1024;
/** One 10 ms frame of 16 kHz mono 16-bit PCM (the frame processor refuses others). */
const FRAME_BYTES = 320;
/** Two minutes for two seats speaking at once: the agreed control-plane outage. */
const OUTAGE_FRAMES = 24_000;
const QUEUE_BYTES = 20 * 1024 * 1024;
const QUEUE_MS = 120_000;
const STAGED_SHARE = 0.3;

/**
 * One capture process's share of the worker's pending-audio bound, so the sum
 * over every concurrent session stays within it however many are configured.
 * A smaller share means a shorter outage is ridden through, and a loss beyond
 * it is a recorded gap. A stream's carry is bounded separately by the clip
 * length.
 */
export function captureMemoryBudget(pendingBytes: number) {
  const staged = Math.min(
    OUTAGE_FRAMES,
    Math.floor((pendingBytes * STAGED_SHARE) / FRAME_BYTES),
  );
  return {
    maxStagedFrames: staged,
    maxQueueBytes: Math.min(QUEUE_BYTES, pendingBytes - staged * FRAME_BYTES),
    // A recovering batch cuts everything staged at once, before the consumer
    // can run, so the queue must hold all of it on top of its ordinary backlog.
    maxQueueMs: staged * 10 + QUEUE_MS,
    // Speech cuts clips at its pauses: bytes and duration bound the audio.
    maxQueueClips: 4096,
  };
}
export const capturePendingBytes = (maxSessions: number) =>
  Math.floor(CAPTURE_PENDING_TOTAL_BYTES / maxSessions);
