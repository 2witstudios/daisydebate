const MAX_WORDS = 8;
const MAX_WORD_LENGTH = 64;

/**
 * A member's words as a prefix `to_tsquery` string, or null with no word. Only
 * letters and digits survive, so nothing they type can be query syntax. The
 * last word is what they are still typing, and every word matches by prefix.
 */
export const documentSearchQuery = (text: string): string | null => {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .slice(0, MAX_WORDS)
    .map((word) => word.slice(0, MAX_WORD_LENGTH));
  return words.length === 0
    ? null
    : words.map((word) => `${word}:*`).join(' & ');
};
