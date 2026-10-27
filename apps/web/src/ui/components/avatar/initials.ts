const wordsOf = (name: string): string[] => {
  const words = name.split(/\s+/).filter(Boolean);
  // One word may be a handle ("debater-a"): read it by its parts.
  return words.length === 1 ? words[0]!.split(/[-_.]+/).filter(Boolean) : words;
};

/**
 * The one reading of a name's initials (ISSUE-731): the first letter of up
 * to two words, so one name gives one letter and a blank name none.
 */
export const initialsOf = (name: string): string =>
  wordsOf(name)
    .slice(0, 2)
    .map((word) => word.slice(0, 1).toLocaleUpperCase())
    .join('');
