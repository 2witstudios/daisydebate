/** What a capture process tells the worker as it ends: counts, never content. */
export type CaptureSummary = { readonly silentClips: number };

/** The child is ours, but its message still crosses a process boundary. */
export function readCaptureSummary(message: unknown): CaptureSummary | null {
  if (typeof message !== 'object' || message === null) return null;
  const { silentClips, ...rest } = message as Record<string, unknown>;
  return Number.isSafeInteger(silentClips) &&
    (silentClips as number) >= 0 &&
    Object.keys(rest).length === 0
    ? { silentClips: silentClips as number }
    : null;
}
