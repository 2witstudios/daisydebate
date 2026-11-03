/** One segment of an Egress attempt, as its held playlist states it. */
export type HoldEntry = {
  readonly name: string;
  readonly capturedAtMs: number;
  readonly durationMs: number;
};

/**
 * Reads the playlist Egress writes beside its held segments. Stops at the first
 * entry without a capture time: its place in time is unknown, so nothing may
 * rely on it, neither a delay counted from it nor a Recording's video time.
 */
/** A plain file name, so a hold's playlist can name nothing outside its own prefix. */
const SEGMENT_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.ts$/;

export const parseHoldPlaylist = (text: string): readonly HoldEntry[] => {
  const entries: HoldEntry[] = [];
  let capturedAtMs = Number.NaN;
  let durationMs = Number.NaN;
  for (const line of text.split('\n')) {
    if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:'))
      capturedAtMs = Date.parse(line.slice(25));
    else if (line.startsWith('#EXTINF:'))
      durationMs = Math.round(parseFloat(line.slice(8)) * 1000);
    else if (line && !line.startsWith('#')) {
      if (
        Number.isNaN(capturedAtMs) ||
        Number.isNaN(durationMs) ||
        !SEGMENT_NAME.test(line.trim())
      )
        return entries;
      entries.push({ name: line.trim(), capturedAtMs, durationMs });
      capturedAtMs = Number.NaN;
      durationMs = Number.NaN;
    }
  }
  return entries;
};
