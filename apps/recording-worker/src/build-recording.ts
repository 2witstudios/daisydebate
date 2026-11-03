import {
  holdAttemptPrefix,
  parseHoldPlaylist,
  type BuiltRecordingMedia,
  type RecordingJobState,
  outsideControlLapses,
  type ControlLapse,
} from '@daisy/protocol';
import {
  attemptSource,
  runsOutsideLapses,
  HOLD_PLAYLIST,
  segmentsSource,
  WHOLE_FILE,
  type AttemptSource,
} from './attempt-source';
import { coverageOf, type CapturedPiece, type Coverage } from './coverage';
import {
  concatList,
  hlsArgs,
  joinSegmentsArgs,
  joinTimelineArgs,
  probeArgs,
  recordingMasterPlaylist,
  RECORDING_RENDITIONS,
  remuxArgs,
} from './media-commands';
import { verificationProblem } from './verify';

export type MediaProbe = {
  readonly durationMs: number;
  readonly hasVideo: boolean;
  readonly hasAudio: boolean;
};

/** Everything a build touches, so its order and its failures can be tested. */
export type BuildPorts = {
  readonly hold: {
    readonly readText: (key: string) => Promise<string>;
    readonly listNames: (prefix: string) => Promise<readonly string[]>;
    readonly download: (key: string, path: string) => Promise<void>;
  };
  readonly recordings: {
    readonly upload: (key: string, path: string) => Promise<void>;
    readonly sizes: (prefix: string) => Promise<ReadonlyMap<string, number>>;
  };
  readonly files: {
    readonly makeDir: (path: string) => Promise<void>;
    readonly write: (path: string, text: string) => Promise<void>;
    readonly read: (path: string) => Promise<string>;
    /** Every file under a directory, relative to it, with its size. */
    readonly list: (dir: string) => Promise<ReadonlyMap<string, number>>;
  };
  /** Runs a command; a non-zero exit rejects. */
  readonly run: (command: readonly string[]) => Promise<string>;
  readonly slatePath: string;
  readonly workDir: string;
  readonly now: () => string;
};

/** The stored media did not match what was built: nothing false may become ready. */
export class RecordingVerificationError extends Error {}

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
const probe = async (ports: BuildPorts, path: string) => {
  const found = await ports
    .run(probeArgs(path))
    .then(probeOutput)
    .catch(() => null);
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
const readAttempt = async (
  ports: BuildPorts,
  lapses: readonly ControlLapse[],
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
  if (outsideControlLapses(entries, lapses).length < entries.length) {
    const pieces: CapturedPiece[] = [];
    let run = 0;
    for (const part of runsOutsideLapses(entries, names, lapses)) {
      if (part.kind !== 'segments') continue;
      const runDir = `${dir}/run-${(run += 1)}`;
      await ports.files.makeDir(runDir);
      const { output, found } = await joinedSegments(
        ports,
        prefix,
        runDir,
        part,
      );
      if (found)
        pieces.push({
          attempt,
          path: output,
          startedAtMs: part.startedAtMs,
          durationMs: found.durationMs,
          hasAudio: found.hasAudio,
        });
    }
    return pieces;
  }
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

const buildDownload = async (
  ports: BuildPorts,
  coverage: Coverage,
  output: string,
) => {
  const [only] = coverage.parts;
  await ports.run(
    coverage.parts.length === 1 && only?.kind === 'media'
      ? remuxArgs(only.piece.path, output)
      : joinTimelineArgs(coverage.parts, ports.slatePath, output),
  );
  const found = await probe(ports, output);
  if (!found) throw new RecordingVerificationError('download_unreadable');
  return found;
};

const buildHls = async (ports: BuildPorts, input: string, dir: string) => {
  for (const { name } of RECORDING_RENDITIONS)
    await ports.files.makeDir(`${dir}/${name}`);
  await ports.run(hlsArgs(input, dir));
  await ports.files.write(`${dir}/master.m3u8`, recordingMasterPlaylist());
};

/**
 * Builds and verifies one Recording from every attempt in order. It answers
 * `built` or `no_media`; anything else throws, and the caller retries. Keys and
 * content are the same on a rerun, so a crash partway repeats harmlessly.
 */
export const buildRecording = async (
  ports: BuildPorts,
  job: {
    readonly recordingId: string;
    readonly holdPrefix: string;
    readonly attemptCount: number;
    readonly controlLapses: readonly ControlLapse[];
  },
): Promise<RecordingJobState> => {
  const pieces: CapturedPiece[] = [];
  for (let attempt = 1; attempt <= job.attemptCount; attempt += 1) {
    pieces.push(
      ...(await readAttempt(ports, job.controlLapses, job.holdPrefix, attempt)),
    );
  }
  const coverage = coverageOf(pieces, job.controlLapses);
  if (coverage === null)
    return { status: 'failed', reason: 'no_media', failedAt: ports.now() };

  const root = `recordings/${job.recordingId}/`;
  const hlsRoot = `${root}hls/`;
  const downloadKey = `${root}video.mp4`;
  const outDir = `${ports.workDir}/out`;
  const hlsDir = `${outDir}/hls`;
  const downloadPath = `${outDir}/video.mp4`;
  await ports.files.makeDir(hlsDir);
  const download = await buildDownload(ports, coverage, downloadPath);
  await buildHls(ports, downloadPath, hlsDir);

  const local = await ports.files.list(outDir);
  const written = new Map(
    [...local].map(([name, size]) => [`${root}${name}`, size] as const),
  );
  for (const name of local.keys())
    await ports.recordings.upload(`${root}${name}`, `${outDir}/${name}`);
  const stored = await ports.recordings.sizes(root);
  const playlists = Object.fromEntries(
    await Promise.all(
      RECORDING_RENDITIONS.map(
        async ({ name }) =>
          [
            name,
            await ports.files.read(`${hlsDir}/${name}/index.m3u8`),
          ] as const,
      ),
    ),
  );
  const problem = verificationProblem({
    expectedDurationMs: coverage.durationMs,
    downloadDurationMs: download.durationMs,
    downloadKey,
    hlsRoot,
    playlists,
    written,
    stored,
  });
  if (problem) throw new RecordingVerificationError(problem);
  const media: BuiltRecordingMedia = {
    capturedFrom: new Date(coverage.capturedFromMs).toISOString(),
    playlistKey: `${hlsRoot}master.m3u8`,
    downloadKey,
    durationMs: download.durationMs,
    byteSize: [...written.values()].reduce((sum, size) => sum + size, 0),
    verifiedAt: ports.now(),
    gaps: [...coverage.gaps],
  };
  return { status: 'built', media };
};
