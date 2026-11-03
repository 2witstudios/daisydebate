/** What a capture process tells the worker as it ends: counts, never content. */
export type CaptureSummary = {
  readonly silentClips: number;
  readonly audibleClips: number;
};
const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;

/** The child is ours, but its message still crosses a process boundary. */
export function readCaptureSummary(message: unknown): CaptureSummary | null {
  if (typeof message !== 'object' || message === null) return null;
  const { silentClips, audibleClips, ...rest } = message as Record<
    string,
    unknown
  >;
  return isCount(silentClips) &&
    isCount(audibleClips) &&
    Object.keys(rest).length === 0
    ? { silentClips, audibleClips }
    : null;
}
