import { RENDITIONS } from './hold-manifest';

/** MPEG-TS timestamps wrap at 2^33 ticks of 90 kHz. */
const TS_WRAP_SECONDS = 2 ** 33 / 90_000;

const SILENCE = 'anullsrc=channel_layout=stereo:sample_rate=48000';
/** The stage's own background: a slate that was never in the hold. */
const SLATE = (width: number, height: number) =>
  `color=c=0x14130f:s=${width}x${height}:r=30`;
const seconds = (ms: number) => (ms / 1000).toFixed(3);
const tsOffset = (capturedAtMs: number) =>
  ((capturedAtMs / 1000) % TS_WRAP_SECONDS).toFixed(3);

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

/**
 * The stage's slate from the hold, with silence for sound: no byte of the hold's
 * audio is in the output, because the audio is another input entirely.
 */
export const silentEncoderArgs = (
  input: string,
  output: (rendition: string) => string,
  capturedAtMs: number,
  cut: { readonly offsetMs: number; readonly durationMs: number },
): readonly string[] => [
  'ffmpeg',
  '-y',
  '-loglevel',
  'error',
  '-i',
  input,
  '-f',
  'lavfi',
  '-t',
  seconds(cut.offsetMs + cut.durationMs),
  '-i',
  SILENCE,
  ...RENDITIONS.flatMap((r) => [
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-vf',
    `scale=${r.width}:${r.height}`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-b:v',
    r.videoBitrate,
    '-c:a',
    'aac',
    '-ss',
    seconds(cut.offsetMs),
    '-t',
    seconds(cut.durationMs),
    '-muxdelay',
    '0',
    '-output_ts_offset',
    tsOffset(capturedAtMs),
    '-f',
    'mpegts',
    output(r.name),
  ]),
];

/** A private span: generated picture and silence, with nothing read from the hold. */
export const slateEncoderArgs = (
  output: (rendition: string) => string,
  capturedAtMs: number,
  durationMs: number,
): readonly string[] => [
  'ffmpeg',
  '-y',
  '-loglevel',
  'error',
  ...RENDITIONS.flatMap((r) => [
    '-f',
    'lavfi',
    '-t',
    seconds(durationMs),
    '-i',
    SLATE(r.width, r.height),
  ]),
  '-f',
  'lavfi',
  '-t',
  seconds(durationMs),
  '-i',
  SILENCE,
  ...RENDITIONS.flatMap((r, index) => [
    '-map',
    `${index}:v`,
    '-map',
    `${RENDITIONS.length}:a`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-b:v',
    r.videoBitrate,
    '-c:a',
    'aac',
    '-muxdelay',
    '0',
    '-output_ts_offset',
    tsOffset(capturedAtMs),
    '-f',
    'mpegts',
    output(r.name),
  ]),
];
