import { RENDITIONS } from './hold-manifest';

/** MPEG-TS timestamps wrap at 2^33 ticks of 90 kHz. */
const TS_WRAP_SECONDS = 2 ** 33 / 90_000;

/**
 * Each segment's timestamps come from its capture time, not from the Egress that
 * wrote it, so they keep rising across an Egress restart. They restarted before,
 * and OBS played the rest of the Round in jumps until it rejoined the feed.
 */
export const encoderArgs = (
  input: string,
  output: (rendition: string) => string,
  capturedAtMs: number,
  /** The part of the segment to keep; absent keeps it whole, with no seek at all. */
  cut?: { readonly offsetMs: number; readonly durationMs: number },
): readonly string[] => [
  'ffmpeg',
  '-y',
  '-loglevel',
  'error',
  '-i',
  input,
  ...RENDITIONS.flatMap((r) => [
    '-map',
    '0:v',
    '-map',
    '0:a',
    '-vf',
    `scale=${r.width}:${r.height}`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-b:v',
    r.videoBitrate,
    '-c:a',
    'copy',
    // After the input, so it decodes to the frame: exact, and at most this one
    // segment's decode on top of an encode that is shorter than the whole.
    ...(cut
      ? [
          '-ss',
          (cut.offsetMs / 1000).toFixed(3),
          '-t',
          (cut.durationMs / 1000).toFixed(3),
        ]
      : []),
    '-muxdelay',
    '0',
    '-output_ts_offset',
    ((capturedAtMs / 1000) % TS_WRAP_SECONDS).toFixed(3),
    '-f',
    'mpegts',
    output(r.name),
  ]),
];
