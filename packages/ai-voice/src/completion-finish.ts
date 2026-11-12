/** How a completion ended, as a closed fact; the raw string goes no further. */
export type CompletionFinish =
  'stop' | 'length' | 'content_filter' | 'other' | 'none';

export const finishOf = (
  reason: string | null | undefined,
): CompletionFinish => {
  if (reason === undefined || reason === null) return 'none';
  return reason === 'stop' || reason === 'length' || reason === 'content_filter'
    ? reason
    : 'other';
};
