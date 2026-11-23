import { tryInstantMs } from '@daisy/clock/instant';
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

/**
 * A held playlist is Egress's word, not ours. It stops at the first entry that names
 * anything but a plain segment, runs backward, or claims media from the future, since
 * a release time rests on these stamps: nothing past that point is believed.
 */
export const parseHoldPlaylist = (
  text: string,
  nowMs: number,
): readonly HoldEntry[] => {
  const entries: HoldEntry[] = [];
  let capturedAtMs: number | undefined;
  let durationMs = Number.NaN;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      capturedAtMs = tryInstantMs(line.slice(25));
      if (capturedAtMs === undefined) return entries;
    } else if (line.startsWith('#EXTINF:'))
      durationMs = Math.round(parseFloat(line.slice(8)) * 1000);
    else if (line && !line.startsWith('#')) {
      if (
        capturedAtMs === undefined ||
        Number.isNaN(durationMs) ||
        !SEGMENT_NAME.test(line.trim()) ||
        capturedAtMs <=
          (entries.at(-1)?.capturedAtMs ?? Number.NEGATIVE_INFINITY) ||
        capturedAtMs + durationMs > nowMs
      )
        return entries;
      entries.push({ name: line.trim(), capturedAtMs, durationMs });
      capturedAtMs = undefined;
      durationMs = Number.NaN;
    }
  }
  return entries;
};
