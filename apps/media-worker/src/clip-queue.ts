import { createAppError } from '@daisy/errors';
type Size = { readonly bytes: number; readonly durationMs: number };
/**
 * Memory-only FIFO. Overflow returns discarded clips so its caller records a gap.
 * A zero-byte clip holds no audio: it does not count against the byte or duration
 * limits and is never evicted to meet them, so losing it could free nothing.
 */
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
  const heldMs = (clip: T) => (clip.bytes > 0 ? clip.durationMs : 0);
  const removeAt = (index: number) => {
    const [clip] = clips.splice(index, 1);
    if (clip) {
      bytes -= clip.bytes;
      durationMs -= heldMs(clip);
    }
    return clip;
  };
  const shift = () => removeAt(0);
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
      durationMs += heldMs(clip);
      while (clips.length > limits.maxClips) dropped.push(shift()!);
      while (bytes > limits.maxBytes || durationMs > limits.maxDurationMs)
        dropped.push(removeAt(clips.findIndex((held) => held.bytes > 0))!);
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
