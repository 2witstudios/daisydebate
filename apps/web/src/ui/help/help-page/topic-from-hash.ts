/** The topic a URL fragment names, when it names one of these topics. */
export const topicFromHash = (
  hash: string,
  topicIds: readonly string[],
): string | null => {
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  return topicIds.includes(id) ? id : null;
};
