const decoded = (fragment: string): string | null => {
  try {
    return decodeURIComponent(fragment);
  } catch {
    // A malformed escape (`#%`) names no topic; it never throws into the page.
    return null;
  }
};

/** The topic a URL fragment names, when it names one of these topics. */
export const topicFromHash = (
  hash: string,
  topicIds: readonly string[],
): string | null => {
  const id = decoded(hash.replace(/^#/, ''));
  return id !== null && topicIds.includes(id) ? id : null;
};
