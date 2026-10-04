import { createAppError } from '@daisy/errors';

/** The longest line a vendor stream may send before it is refused. */
const MAX_LINE_CHARS = 1_048_576;

/**
 * The complete text lines of a byte stream, as they arrive. A line longer
 * than `maxLineChars` (a stream that never sends a newline) is refused and
 * the stream cancelled, so the buffer can never grow without bound.
 */
export async function* readLines(
  body: ReadableStream<Uint8Array>,
  maxLineChars = MAX_LINE_CHARS,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let ended = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      if (buffered.length > maxLineChars)
        throw createAppError('INFRASTRUCTURE', 'A stream line was too long');
      yield* lines;
    }
    ended = true;
    if (buffered) yield buffered;
  } finally {
    // Stopped early (refused, or the reader walked away): drop the rest.
    if (!ended) await reader.cancel().catch(() => undefined);
  }
}
