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

/**
 * The words of an authored phrase actually heard when its playout stopped
 * after `playedFraction` of its audio (ADR 0122): whole words only, never one
 * that was not fully played, never text the phrase did not contain. A
 * fraction outside [0, 1] is clamped.
 */
export function spokenPrefix(text: string, playedFraction: number): string {
  const words = wordsOf(text);
  const fraction = Number.isFinite(playedFraction)
    ? Math.min(1, Math.max(0, playedFraction))
    : 0;
  return words.slice(0, Math.floor(fraction * words.length)).join(' ');
}
