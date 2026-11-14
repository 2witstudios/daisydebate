/** A debater's first name, for column heads and tight labels. */
export const firstName = (name: string): string => name.split(/\s+/)[0] ?? name;
