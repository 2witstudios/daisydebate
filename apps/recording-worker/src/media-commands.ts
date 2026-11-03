import type { TimelinePart } from './coverage';

/** What a viewer can choose. The whole-video download is the 720p master. */
export const RECORDING_RENDITIONS = [
  { name: '720', width: 1280, height: 720, videoKbps: 2500, audioKbps: 128 },
  { name: '480', width: 854, height: 480, videoKbps: 1200, audioKbps: 96 },
  { name: '240', width: 426, height: 240, videoKbps: 400, audioKbps: 64 },
] as const;

const SEGMENT_SECONDS = 4;
const FPS = 30;
const seconds = (ms: number) => (ms / 1000).toFixed(3);

export const probeArgs = (path: string): readonly string[] => [
  'ffprobe',
  '-v',
  'error',
  '-show_entries',
  'format=duration:stream=codec_type',
  '-of',
  'json',
  path,
];

/** A crashed attempt's segments become one file, unchanged. */
export const joinSegmentsArgs = (
  listFile: string,
  output: string,
): readonly string[] => [
  'ffmpeg',
  '-y',
  '-loglevel',
  'error',
  '-f',
  'concat',
  '-safe',
  '0',
  '-i',
  listFile,
  '-c',
  'copy',
  '-movflags',
  '+faststart',
  output,
];

export const concatList = (paths: readonly string[]): string =>
  paths.map((path) => `file '${path.replaceAll("'", "'\\''")}'\n`).join('');

/** One clean attempt needs no second encode: the download is that file, made seekable. */
export const remuxArgs = (input: string, output: string): readonly string[] => [
  'ffmpeg',
  '-y',
  '-loglevel',
  'error',
  '-i',
  input,
  '-c',
  'copy',
  '-movflags',
  '+faststart',
  output,
];

const master = RECORDING_RENDITIONS[0];
const fit = `scale=${master.width}:${master.height}:force_original_aspect_ratio=decrease,pad=${master.width}:${master.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p`;
const SILENCE = 'anullsrc=channel_layout=stereo:sample_rate=48000';

/**
 * Attempts and gap slates joined in order, one input per part plus silence for
 * whatever carries no audio. A gap is slate video of its real length, so a
 * download states it as plainly as the player does.
 */
export const joinTimelineArgs = (
  parts: readonly TimelinePart[],
  slatePath: string,
  output: string,
): readonly string[] => {
  const inputs: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];
  let next = 0;
  const addInput = (...args: string[]) => {
    inputs.push(...args);
    return next++;
  };
  parts.forEach((part, index) => {
    const durationMs =
      part.kind === 'media' ? part.piece.durationMs : part.durationMs;
    const video =
      part.kind === 'media'
        ? addInput('-i', part.piece.path)
        : addInput('-loop', '1', '-t', seconds(durationMs), '-i', slatePath);
    filters.push(`[${video}:v:0]${fit}[v${index}]`);
    const audio =
      part.kind === 'media' && part.piece.hasAudio
        ? `${video}:a:0`
        : `${addInput('-f', 'lavfi', '-t', seconds(durationMs), '-i', SILENCE)}:a:0`;
    filters.push(
      `[${audio}]aresample=48000,aformat=channel_layouts=stereo[a${index}]`,
    );
    labels.push(`[v${index}][a${index}]`);
  });
  return [
    'ffmpeg',
    '-y',
    '-loglevel',
    'error',
    ...inputs,
    '-filter_complex',
    `${filters.join(';')};${labels.join('')}concat=n=${parts.length}:v=1:a=1[v][a]`,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-b:v',
    `${master.videoKbps}k`,
    '-c:a',
    'aac',
    '-b:a',
    `${master.audioKbps}k`,
    '-movflags',
    '+faststart',
    output,
  ];
};

/** Every rendition, keyframes aligned, so a player can switch at any segment. */
export const hlsArgs = (
  input: string,
  outputDir: string,
): readonly string[] => [
  'ffmpeg',
  '-y',
  '-loglevel',
  'error',
  '-i',
  input,
  ...RECORDING_RENDITIONS.flatMap((r) => [
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-vf',
    `scale=${r.width}:${r.height}`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-b:v',
    `${r.videoKbps}k`,
    '-force_key_frames',
    `expr:gte(t,n_forced*${SEGMENT_SECONDS})`,
    '-sc_threshold',
    '0',
    '-c:a',
    'aac',
    '-b:a',
    `${r.audioKbps}k`,
    '-f',
    'hls',
    '-hls_time',
    String(SEGMENT_SECONDS),
    '-hls_playlist_type',
    'vod',
    '-hls_flags',
    'independent_segments',
    '-hls_segment_filename',
    `${outputDir}/${r.name}/seg-%05d.ts`,
    `${outputDir}/${r.name}/index.m3u8`,
  ]),
];

export const recordingMasterPlaylist = (): string =>
  '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-INDEPENDENT-SEGMENTS\n' +
  RECORDING_RENDITIONS.map(
    (r) =>
      `#EXT-X-STREAM-INF:BANDWIDTH=${(r.videoKbps + r.audioKbps) * 1000},RESOLUTION=${r.width}x${r.height},CODECS="avc1.64001f,mp4a.40.2"\n${r.name}/index.m3u8\n`,
  ).join('');
