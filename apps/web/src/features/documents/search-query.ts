const MAX_WORDS = 8;
const MAX_WORD_LENGTH = 64;

/**
 * A member's words as a prefix `to_tsquery` string, or null with no word. Only
 * letters, their combining marks and digits survive, so nothing they type can be query syntax. The
 * last word is what they are still typing, and every word matches by prefix.
 */
export const documentSearchQuery = (text: string): string | null => {
  const words = (
    text
      .normalize('NFC')
      .toLowerCase()
      .match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
  )
    .slice(0, MAX_WORDS)
    .map((word) => word.slice(0, MAX_WORD_LENGTH));
  // Stored text is as it was typed or pasted, so a word that composes both ways
  // is looked for both ways.
  const term = (word: string) => {
    const decomposed = word.normalize('NFD');
    return decomposed === word ? `${word}:*` : `(${word}:* | ${decomposed}:*)`;
  };
  return words.length === 0 ? null : words.map(term).join(' & ');
};
