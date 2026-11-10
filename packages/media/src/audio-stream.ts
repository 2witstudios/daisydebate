import { createAppError } from '@daisy/errors';

/** The part of a native publication a stream writes to. */
export type StreamTarget = {
  readonly capture10ms: (frame: Int16Array) => Promise<void>;
  readonly queuedMs: () => number;
  readonly clearQueue: () => void;
};
export type StreamResult = {
  /** Samples per channel handed to the source. */
  readonly sentSamples: number;
  /** Samples per channel that left the queue, as best the source knows. */
  readonly playedSamples: number;
  readonly aborted: boolean;
  /** The stream stopped short at its local hard stop (`stopAtMs`). */
  readonly cut: boolean;
  /** Why the native handoff failed, when it did: the stream stopped there. */
  readonly failure?: unknown;
};

/**
 * A plain real-time PCM writer (ADR 0122): each 10 ms frame is handed over
 * on a monotonic schedule, `leadMs` ahead of its playout, into a buffered
 * native source. Nothing but the clock and the handoff is awaited, so no
 * authority check, database call or other work can stall the stream. An
 * abort clears the queue at once and reports how far playout got: samples
 * still queued were never heard, so they never count as played.
 *
 * Playout follows the queue: a frame plays once everything handed before it
 * has, so the schedule starts after what is already queued. A frame whose
 * playout would end after `stopAtMs` is never handed over, so no audio plays
 * past a local hard stop, whatever the lead or the queue (ADR 0122).
 */
export function createStreamingAudioWriter(input: {
  readonly target: StreamTarget;
  readonly sampleRate: 24000 | 48000;
  readonly channels: 1 | 2;
  readonly nowMs: () => number;
  /** Resolves at `dueMs`, or early once `signal` aborts. */
  readonly waitUntilMs: (dueMs: number, signal: AbortSignal) => Promise<void>;
  readonly leadMs: number;
}) {
  if (!Number.isFinite(input.leadMs) || input.leadMs < 0 || input.leadMs > 1000)
    throw createAppError('VALIDATION', 'Invalid stream lead');
  const size = (input.sampleRate / 100) * input.channels;
  return async (
    pcm: Int16Array,
    signal: AbortSignal,
    /** The monotonic instant no audio may play past. */
    stopAtMs = Infinity,
  ): Promise<StreamResult> => {
    if (
      !(pcm instanceof Int16Array) ||
      pcm.length === 0 ||
      pcm.length % size !== 0
    )
      throw createAppError('VALIDATION', 'PCM must be whole 10 ms frames');
    const frames = pcm.length / size;
    const startMs = input.nowMs() + Math.max(0, input.target.queuedMs() || 0);
    const perFrame = size / input.channels;
    let sent = 0;
    const stopped = () => {
      const queued = Math.min(
        sent * 10,
        Math.max(0, input.target.queuedMs() || 0),
      );
      input.target.clearQueue();
      const playedFrames = Math.max(0, sent - Math.ceil(queued / 10));
      return {
        sentSamples: sent * perFrame,
        playedSamples: playedFrames * perFrame,
        aborted: true,
        cut: false,
      };
    };
    /** Every handed frame plays before the stop, so all of it counts. */
    const cut = () => ({
      sentSamples: sent * perFrame,
      playedSamples: sent * perFrame,
      aborted: false,
      cut: true,
    });
    for (let frame = 0; frame < frames; frame += 1) {
      if (signal.aborted) return stopped();
      const due = startMs + frame * 10 - input.leadMs;
      if (input.nowMs() < due) await input.waitUntilMs(due, signal);
      if (signal.aborted) return stopped();
      // Where this frame's playout would end: on schedule, or later after an
      // underrun, since it plays only once the queue ahead of it has.
      const playsUntil = Math.max(
        startMs + (frame + 1) * 10,
        input.nowMs() + Math.max(0, input.target.queuedMs() || 0) + 10,
      );
      if (playsUntil > stopAtMs) return cut();
      try {
        await input.target.capture10ms(
          pcm.subarray(frame * size, (frame + 1) * size),
        );
      } catch (failure) {
        // Still says how far playout got, so the line is cut where audio was.
        return { ...stopped(), failure };
      }
      sent += 1;
    }
    if (signal.aborted) return stopped();
    const samples = sent * perFrame;
    return {
      sentSamples: samples,
      playedSamples: samples,
      aborted: false,
      cut: false,
    };
  };
}
