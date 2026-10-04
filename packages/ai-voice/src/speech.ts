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
 * The longest phrase voiced in one request, in characters: two or three
 * sentences, so intonation carries across them, yet short enough that one
 * phrase plays for longer than the next takes to voice.
 */
const PHRASE_CHARS = 320;

/**
 * The second phrase's limit: short, so it is written and voiced while the
 * opening sentence plays, before phrases grow to full length.
 */
const SECOND_PHRASE_CHARS = 160;

/**
 * Groups whole sentences into phrases, each voiced in one request so the
 * voice flows across sentence boundaries. The first phrase is one sentence
 * alone and the second stays short, so the speaker starts quickly; later
 * ones take sentences while they fit `maxChars` (a longer sentence stands
 * alone). A phrase closes
 * only when the next sentence does not fit or the speech ends, so phrases
 * built as sentences stream in equal those of the finished text.
 */
export function createPhraseBuffer(maxChars = PHRASE_CHARS) {
  let open: string[] = [];
  let emitted = 0;
  const close = () => {
    const phrase = open.join(' ');
    open = [];
    emitted += 1;
    return phrase;
  };
  return {
    push(sentence: string): string[] {
      if (emitted === 0 && open.length === 0) {
        open = [sentence];
        return [close()];
      }
      const limit =
        emitted === 1 ? Math.min(maxChars, SECOND_PHRASE_CHARS) : maxChars;
      const fits = [...open, sentence].join(' ').length <= limit;
      if (open.length === 0 || fits) {
        open.push(sentence);
        return [];
      }
      const done = close();
      open = [sentence];
      return [done];
    },
    flush(): string[] {
      return open.length ? [close()] : [];
    },
  };
}

/** The phrases of finished text, exactly as they were voiced. */
export function phrasesOf(text: string, maxChars = PHRASE_CHARS): string[] {
  const buffer = createPhraseBuffer(maxChars);
  return [
    ...splitSentences(text).flatMap((sentence) => buffer.push(sentence)),
    ...buffer.flush(),
  ];
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

/** Voice under this long in a clip is silence, breath or a cough. */
const MIN_VOICED_MS = 500;

/**
 * Whether a recorded clip is worth transcribing. Speech-to-text models
 * invent words ("Thank you.") from silence and noise, so a clip with too
 * little voice in it is never sent.
 */
export const worthTranscribing = ({
  voicedMs,
}: {
  readonly voicedMs: number;
}) => voicedMs >= MIN_VOICED_MS;
