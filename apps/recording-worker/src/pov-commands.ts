import type { PovQuality } from '@daisy/protocol';
import { FFMPEG_PROGRESS, seconds, SILENCE } from './media-commands';
import type { PovTimelinePart } from './pov-timeline';

const PICTURE: Readonly<
  Record<
    PovQuality,
    {
      readonly width: number;
      readonly height: number;
      readonly videoKbps: number;
    }
  >
> = {
  '540p': { width: 960, height: 540, videoKbps: 800 },
  '360p': { width: 640, height: 360, videoKbps: 450 },
};
const FPS = 25;
const AUDIO_KBPS = 64;

const fitTo = ({ width, height }: (typeof PICTURE)[PovQuality]) =>
  `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p`;

/**
 * A POV's whole timeline in one encode: each public clip seeks its source, so the cut
 * and the slate are one generation rather than two, and a null picture is voice alone.
 * The seek decodes up to the frame, so nothing before it reaches the output.
 */
export const povTimelineArgs = (
  parts: readonly PovTimelinePart[],
  slatePath: string,
  output: string,
  picture: PovQuality | null,
): readonly string[] => {
  const inputs: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];
  let next = 0;
  const addInput = (...args: string[]) => {
    inputs.push(...args);
    return next++;
  };
  const mediaInput = (offsetMs: number, durationMs: number, path: string) =>
    addInput('-ss', seconds(offsetMs), '-t', seconds(durationMs), '-i', path);
  const silence = (durationMs: number) =>
    addInput('-f', 'lavfi', '-t', seconds(durationMs), '-i', SILENCE);
  parts.forEach((part, index) => {
    const durationMs =
      part.kind === 'media' ? part.clip.durationMs : part.durationMs;
    const source =
      part.kind === 'media'
        ? mediaInput(part.clip.offsetMs, durationMs, part.clip.path)
        : picture
          ? addInput('-loop', '1', '-t', seconds(durationMs), '-i', slatePath)
          : null;
    if (picture)
      filters.push(`[${source}:v:0]${fitTo(PICTURE[picture])}[v${index}]`);
    const audio =
      part.kind === 'media' && part.clip.hasAudio
        ? `${source}:a:0`
        : `${silence(durationMs)}:a:0`;
    filters.push(
      `[${audio}]aresample=48000,aformat=channel_layouts=stereo[a${index}]`,
    );
    labels.push(picture ? `[v${index}][a${index}]` : `[a${index}]`);
  });
  return [
    'ffmpeg',
    '-y',
    '-loglevel',
    'error',
    ...FFMPEG_PROGRESS,
    ...inputs,
    '-filter_complex',
    `${filters.join(';')};${labels.join('')}concat=n=${parts.length}:v=${picture ? 1 : 0}:a=1${picture ? '[v]' : ''}[a]`,
    ...(picture
      ? [
          '-map',
          '[v]',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-b:v',
          `${PICTURE[picture].videoKbps}k`,
        ]
      : []),
    '-map',
    '[a]',
    '-c:a',
    'aac',
    '-b:a',
    `${AUDIO_KBPS}k`,
    '-movflags',
    '+faststart',
    output,
  ];
};

/** The voice of a finished POV, the same stream unchanged: no further encode. */
export const povAudioArgs = (
  video: string,
  output: string,
): readonly string[] => [
  'ffmpeg',
  '-y',
  '-loglevel',
  'error',
  '-i',
  video,
  '-map',
  '0:a:0',
  '-c:a',
  'copy',
  '-movflags',
  '+faststart',
  output,
];
