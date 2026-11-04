/** A phrase already sent: only its length matters to a rewind. */
type SentPhrase = { readonly pcm: { readonly length: number } };

/**
 * How far back a bot can say again, past the longest an incident takes to detect. A bound,
 * because a speech's audio is held in memory only to survive an incident.
 */
const REWIND_SAMPLES = 24000 * 30;

/** Adds a phrase just sent, and lets go of those past the furthest a rewind reaches. */
export const keepForRewind = <T extends SentPhrase>(
  said: ReadonlyMap<number, T>,
  index: number,
  phrase: T,
): ReadonlyMap<number, T> => {
  const kept = new Map([...said, [index, phrase]]);
  let reach = 0;
  for (const at of [...kept.keys()].sort((a, b) => b - a)) {
    if (reach >= REWIND_SAMPLES) kept.delete(at);
    reach += kept.get(at)?.pcm.length ?? 0;
  }
  return kept;
};

/**
 * The phrase whose start covers the speech no one confirmed hearing. A phrase is the unit, so
 * nothing resumes mid-word; it may repeat up to a phrase, and never loses one it still holds.
 */
export const rewoundPhrase = <T extends SentPhrase>(input: {
  readonly spoken: number;
  readonly sent: number;
  readonly said: ReadonlyMap<number, T>;
  readonly unheardSamples: number;
}): number => {
  let left = input.unheardSamples - input.sent;
  let phrase = input.spoken;
  while (left > 0 && input.said.has(phrase - 1)) {
    phrase -= 1;
    left -= input.said.get(phrase)!.pcm.length;
  }
  return phrase;
};
