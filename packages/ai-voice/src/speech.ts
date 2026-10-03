/** A speaking rate for budgeting speeches, in words per minute. */
const DEFAULT_WORDS_PER_MINUTE = 150;

/**
 * How many words to ask for so a speech fits its slot: the rate times the
 * slot, at 90 percent so the voice ends just before time rather than being
 * cut off mid-sentence.
 */
export const wordBudget = (
  durationMs: number,
  wordsPerMinute = DEFAULT_WORDS_PER_MINUTE,
) => Math.floor((durationMs / 60_000) * wordsPerMinute * 0.9);

/** A sentence ends at . ! or ? followed by whitespace (so 3.5 stays whole). */
const SENTENCE_END = /(?<=[.!?]["')\]]?)\s+/;

/** Splits prose into trimmed sentences; the tail without a stop is one too. */
export function splitSentences(text: string): string[] {
  return text
    .split(SENTENCE_END)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * Turns streamed text into whole sentences as soon as each completes, so a
 * speech can start being voiced before the model finishes writing it.
 */
export function createSentenceBuffer() {
  let pending = '';
  return {
    push(delta: string): string[] {
      pending += delta;
      const parts = pending.split(SENTENCE_END);
      pending = parts.pop() ?? '';
      return parts.map((part) => part.trim()).filter((part) => part.length > 0);
    },
    flush(): string[] {
      const tail = pending.trim();
      pending = '';
      return tail ? [tail] : [];
    },
  };
}

/**
 * The part of a spoken reply the listener heard before it was cut off, by
 * the share of its audio that played, cut back to a word boundary. The
 * voice returns no word timings, so this is a proportional estimate.
 */
export function heardText(text: string, playedMs: number, totalMs: number) {
  if (totalMs <= 0 || playedMs >= totalMs) return text;
  if (playedMs <= 0) return '';
  const cut = Math.floor((playedMs / totalMs) * text.length);
  const boundary = text.slice(0, cut + 1).lastIndexOf(' ');
  return (boundary > 0 ? text.slice(0, boundary) : text.slice(0, cut)).trim();
}
