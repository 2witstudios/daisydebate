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
function createPhraseBuffer(maxChars = PHRASE_CHARS) {
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

/**
 * Phrases from text that arrives in pieces of any size: each phrase is
 * returned as soon as it is decided, and together they equal `phrasesOf` of
 * the whole text. A sentence is decided only once the whitespace after its
 * stop has arrived, so a piece boundary never splits one.
 */
export function createPhraseStream(maxChars = PHRASE_CHARS) {
  const buffer = createPhraseBuffer(maxChars);
  let pending = '';
  /** The sentences decided so far leave `pending`; its tail may still grow. */
  const decided = () => {
    const pieces = pending.split(SENTENCE_END);
    pending = pieces.pop() ?? '';
    return pieces
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0)
      .flatMap((sentence) => buffer.push(sentence));
  };
  return {
    /** More text; returns the phrases it closed. */
    push(text: string): string[] {
      pending += text;
      return decided();
    },
    /** The text is finished: its tail is a sentence too, as in `phrasesOf`. */
    end(): string[] {
      const tail = pending.trim();
      pending = '';
      return [...(tail ? buffer.push(tail) : []), ...buffer.flush()];
    },
    /**
     * The text stopped short: the whole sentences still open are a phrase,
     * and the unfinished one is dropped, never spoken as if it were whole.
     */
    cut(): string[] {
      pending = '';
      return buffer.flush();
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
