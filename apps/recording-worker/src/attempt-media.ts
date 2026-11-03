import { holdAttemptPrefix, parseHoldPlaylist } from '@daisy/protocol';
import {
  attemptSource,
  HOLD_PLAYLIST,
  segmentsSource,
  WHOLE_FILE,
  type AttemptSource,
} from './attempt-source';
import type { BuildPorts, MediaProbe } from './build-ports';
import type { CapturedPiece } from './coverage';
import { concatList, joinSegmentsArgs, probeArgs } from './media-commands';

const probeOutput = (text: string): MediaProbe | null => {
  const parsed = JSON.parse(text) as {
    readonly format?: { readonly duration?: string };
    readonly streams?: readonly { readonly codec_type?: string }[];
  };
  const seconds = parseFloat(parsed.format?.duration ?? '');
  if (!(seconds > 0)) return null;
  const has = (kind: string) =>
    (parsed.streams ?? []).some((stream) => stream.codec_type === kind);
  return {
    durationMs: Math.round(seconds * 1000),
    hasVideo: has('video'),
    hasAudio: has('audio'),
  };
};

/** A file ffprobe cannot read is what a crashed writer leaves: not media, no error. */
export const probeMedia = (ports: BuildPorts, path: string) =>
  ports
    .run(probeArgs(path))
    .then(probeOutput)
    .catch(() => null);

/** A video file, or nothing: Egress always writes a picture. */
export const probe = async (ports: BuildPorts, path: string) => {
  const found = await probeMedia(ports, path);
  return found?.hasVideo ? found : null;
};

const readableWholeFile = async (
  ports: BuildPorts,
  key: string,
  path: string,
) => {
  await ports.hold.download(key, path);
  return probe(ports, path);
};

const joinedSegments = async (
  ports: BuildPorts,
  prefix: string,
  dir: string,
  source: Extract<AttemptSource, { kind: 'segments' }>,
) => {
  const paths: string[] = [];
  for (const entry of source.entries) {
    const path = `${dir}/${entry.name}`;
    await ports.hold.download(`${prefix}${entry.name}`, path);
    paths.push(path);
  }
  const list = `${dir}/segments.txt`;
  const output = `${dir}/segments.mp4`;
  await ports.files.write(list, concatList(paths));
  await ports.run(joinSegmentsArgs(list, output));
  return { output, found: await probe(ports, output) };
};

/** One attempt's media as a local file, or null when it left nothing readable. */
export const readAttempt = async (
  ports: BuildPorts,
  holdPrefix: string,
  attempt: number,
): Promise<readonly CapturedPiece[]> => {
  const prefix = holdAttemptPrefix(holdPrefix, attempt);
  const entries = parseHoldPlaylist(
    await ports.hold.readText(`${prefix}${HOLD_PLAYLIST}`),
  );
  const names = new Set(await ports.hold.listNames(prefix));
  const dir = `${ports.workDir}/attempt-${attempt}`;
  await ports.files.makeDir(dir);
  const source = attemptSource(entries, names);
  if (source.kind === 'absent') return [];
  if (source.kind === 'whole_file') {
    const path = `${dir}/${WHOLE_FILE}`;
    const found = await readableWholeFile(
      ports,
      `${prefix}${WHOLE_FILE}`,
      path,
    );
    if (found)
      return [
        {
          attempt,
          path,
          startedAtMs: source.startedAtMs,
          durationMs: found.durationMs,
          hasAudio: found.hasAudio,
        },
      ];
  }
  const segments = segmentsSource(entries, names);
  if (segments.kind !== 'segments') return [];
  const { output, found } = await joinedSegments(ports, prefix, dir, segments);
  return found
    ? [
        {
          attempt,
          path: output,
          startedAtMs: segments.startedAtMs,
          durationMs: found.durationMs,
          hasAudio: found.hasAudio,
        },
      ]
    : [];
};
