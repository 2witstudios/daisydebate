const wordsOf = (text: string) => text.trim().split(/\s+/).filter(Boolean);

/**
 * True when `spoken` is a whole-word prefix of `authored`: a cut bot phrase
 * keeps only words it said, in order, and invents none (ADR 0122).
 */
export function isSpokenPrefix(authored: string, spoken: string): boolean {
  const words = wordsOf(authored);
  const heard = wordsOf(spoken);
  return (
    heard.length <= words.length &&
    heard.every((word, index) => word === words[index])
  );
}
