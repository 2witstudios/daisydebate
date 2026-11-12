/**
 * A bot answer as its speaker sees it: phrases in order, each available once
 * it was produced, then an end. The speaker does not know when or how they
 * were produced. A streamed provider answer produces them as its sentences
 * are written; an answer made before its turn would produce them all at once.
 */
export type PhraseSource = {
  /** Phrase `index` if it was already produced. */
  readonly ready: (index: number) => string | undefined;
  /**
   * Phrase `index` once produced, or null when the answer ended before it.
   * It never rejects: an answer that stopped short simply ends early.
   */
  readonly at: (index: number) => Promise<string | null>;
  /** Whether the answer ended, whole or cut. */
  readonly ended: () => boolean;
  /** Why the answer stopped short, when it did. */
  readonly cutBy: () => { readonly error: unknown } | null;
};

/** The producer's side of one phrase source. */
export function createPhraseSource() {
  const phrases: string[] = [];
  let ended = false;
  let cut: { readonly error: unknown } | null = null;
  let waiting: (() => void)[] = [];
  const changed = () => {
    const woken = waiting;
    waiting = [];
    for (const wake of woken) wake();
  };
  const finish = () => {
    ended = true;
    changed();
  };
  const source: PhraseSource = {
    ready: (index) => phrases[index],
    at: async (index) => {
      while (index >= phrases.length && !ended)
        await new Promise<void>((resolve) => waiting.push(resolve));
      return phrases[index] ?? null;
    },
    ended: () => ended,
    cutBy: () => cut,
  };
  return {
    source,
    /** The next phrases, in order. Nothing is added once the answer ended. */
    push(produced: readonly string[]) {
      if (ended || produced.length === 0) return;
      phrases.push(...produced);
      changed();
    },
    /** The answer is whole. */
    end() {
      if (!ended) finish();
    },
    /** The answer stopped short of its end: what was produced still stands. */
    cut(error: unknown) {
      if (ended) return;
      cut = { error };
      finish();
    },
  };
}

/** A finished answer as a phrase source. */
export function phraseSourceOf(phrases: readonly string[]): PhraseSource {
  const producer = createPhraseSource();
  producer.push(phrases);
  producer.end();
  return producer.source;
}
