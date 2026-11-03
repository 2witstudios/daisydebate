import { RECORDING_RENDITIONS } from './media-commands';

/** Encoders round durations; anything past this is media gone missing. */
const DURATION_TOLERANCE_MS = 1000;

export type VerificationFailure = { readonly problem: string };

/** The segment names a finished VOD playlist promises, or why it is not finished. */
export const playlistSegments = (
  text: string,
): {
  readonly names: readonly string[];
  readonly durationMs: number;
} | null => {
  if (!text.includes('#EXT-X-ENDLIST')) return null;
  const names: string[] = [];
  let durationMs = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('#EXTINF:'))
      durationMs += Math.round(parseFloat(line.slice(8)) * 1000);
    else if (line && !line.startsWith('#')) names.push(line.trim());
  }
  return names.length > 0 ? { names, durationMs } : null;
};

/**
 * Ready means verified: every rendition is finished, runs as long as the
 * timeline says, has every segment it names in the bucket at the size written,
 * and so does the whole video. Returns the first problem found, or null.
 */
export const verificationProblem = (input: {
  readonly expectedDurationMs: number;
  readonly downloadDurationMs: number;
  readonly downloadKey: string;
  readonly hlsRoot: string;
  readonly playlists: Readonly<Record<string, string>>;
  readonly written: ReadonlyMap<string, number>;
  readonly stored: ReadonlyMap<string, number>;
}): string | null => {
  const within = (ms: number) =>
    Math.abs(ms - input.expectedDurationMs) <= DURATION_TOLERANCE_MS;
  if (!within(input.downloadDurationMs)) return 'download_duration';
  if (!input.written.has(input.downloadKey)) return 'download_missing';
  for (const { name } of RECORDING_RENDITIONS) {
    const text = input.playlists[name];
    const segments = text === undefined ? null : playlistSegments(text);
    if (segments === null) return `playlist_unfinished_${name}`;
    if (!within(segments.durationMs)) return `playlist_duration_${name}`;
    for (const segment of segments.names)
      if (!input.written.has(`${input.hlsRoot}${name}/${segment}`))
        return `segment_missing_${name}`;
  }
  for (const [key, size] of input.written)
    if (input.stored.get(key) !== size) return 'object_mismatch';
  return null;
};
