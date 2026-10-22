import { createAppError } from '@daisy/errors';
type Size = { readonly bytes: number; readonly durationMs: number };
/** Memory-only FIFO. Overflow returns discarded clips so its caller records a gap. */
export function createClipQueue<T extends Size>(limits: {
  readonly maxClips: number;
  readonly maxBytes: number;
  readonly maxDurationMs: number;
}) {
  if (!Object.values(limits).every((n) => Number.isSafeInteger(n) && n > 0))
    throw createAppError('VALIDATION');
  const clips: T[] = [];
  let bytes = 0,
    durationMs = 0;
  const shift = () => {
    const clip = clips.shift();
    if (clip) {
      bytes -= clip.bytes;
      durationMs -= clip.durationMs;
    }
    return clip;
  };
  return {
    push(clip: T): T[] {
      if (
        !Number.isSafeInteger(clip.bytes) ||
        clip.bytes < 0 ||
        !Number.isSafeInteger(clip.durationMs) ||
        clip.durationMs <= 0
      )
        throw createAppError('VALIDATION');
      const dropped: T[] = [];
      clips.push(clip);
      bytes += clip.bytes;
      durationMs += clip.durationMs;
      while (
        clips.length > limits.maxClips ||
        bytes > limits.maxBytes ||
        durationMs > limits.maxDurationMs
      )
        dropped.push(shift()!);
      return dropped;
    },
    shift,
    clear() {
      while (shift()) {
        /* release PCM references */
      }
    },
  };
}
