/** Reads Egress's held playlist and writes the public one; Daisy owns both (ADR 0099). */
export const RENDITIONS = [
  { name: '720', width: 1280, height: 720, videoBitrate: '2500k' },
  { name: '480', width: 854, height: 480, videoBitrate: '1200k' },
  { name: '240', width: 426, height: 240, videoBitrate: '400k' },
] as const;

export type HoldEntry = {
  readonly name: string;
  readonly capturedAtMs: number;
  readonly durationMs: number;
};

export type ReleasedSegment = {
  readonly seq: number;
  readonly capturedAtMs: number;
  readonly durationMs: number;
};

/**
 * Stops at the first entry without a capture time: the delay is counted from
 * it, so a segment whose age is unknown must never become due.
 */
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
      if (Number.isNaN(capturedAtMs) || Number.isNaN(durationMs))
        return entries;
      entries.push({ name: line.trim(), capturedAtMs, durationMs });
      capturedAtMs = Number.NaN;
      durationMs = Number.NaN;
    }
  }
  return entries;
};

export const mediaPlaylist = (
  segments: readonly ReleasedSegment[],
  options: {
    readonly ended: boolean;
    /** Later Egress attempts: each starts a discontinuity at its first sequence. */
    readonly attempt?: { readonly index: number; readonly firstSeq: number };
  },
): string => {
  const target = Math.ceil(
    Math.max(1000, ...segments.map((s) => s.durationMs)) / 1000,
  );
  const attempt = options.attempt ?? { index: 0, firstSeq: -1 };
  const shown = segments.some((s) => s.seq === attempt.firstSeq);
  const passed = Math.max(0, attempt.index - (shown ? 1 : 0));
  const body = segments
    .map(
      (s) =>
        (s.seq === attempt.firstSeq && attempt.index > 0
          ? '#EXT-X-DISCONTINUITY\n'
          : '') +
        `#EXT-X-PROGRAM-DATE-TIME:${new Date(s.capturedAtMs).toISOString()}\n` +
        `#EXTINF:${(s.durationMs / 1000).toFixed(3)},\nseg-${s.seq}.ts\n`,
    )
    .join('');
  return (
    `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:${target}\n` +
    `#EXT-X-MEDIA-SEQUENCE:${segments[0]?.seq ?? 0}\n` +
    (passed > 0 ? `#EXT-X-DISCONTINUITY-SEQUENCE:${passed}\n` : '') +
    body +
    (options.ended ? '#EXT-X-ENDLIST\n' : '')
  );
};

/**
 * A released segment never changes, but a delete must reach readers: Tigris keeps
 * serving a deleted object for as long as it is read, at max-age=10 and above
 * (measured on staging: still 200 after 150 s), so a takedown would miss exactly
 * the viewers it is for. With no-cache it was gone in 2.3 s, at the same latency.
 */
export const SEGMENT_CACHE_CONTROL = 'no-cache';

export const masterPlaylist = (): string =>
  '#EXTM3U\n' +
  RENDITIONS.map(
    (r) =>
      `#EXT-X-STREAM-INF:BANDWIDTH=${parseInt(r.videoBitrate, 10) * 1000},RESOLUTION=${r.width}x${r.height}\n${r.name}/index.m3u8\n`,
  ).join('');
