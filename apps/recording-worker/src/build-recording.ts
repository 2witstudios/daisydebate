import {
  holdAttemptPrefix,
  parseHoldPlaylist,
  type BuiltRecordingMedia,
  type RecordingBuildProgress,
  type RecordingJobState,
  publicClips,
  type PublicInterval,
} from '@daisy/protocol';
import {
  attemptSource,
  continuousRuns,
  HOLD_PLAYLIST,
  segmentsSource,
  WHOLE_FILE,
  type AttemptSource,
} from './attempt-source';
import { coverageOf, type CapturedPiece, type Coverage } from './coverage';
import {
  concatList,
  cutArgs,
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
  /**
   * Runs a command; a non-zero exit rejects. `onEncodedMs` hears how much video an
   * ffmpeg asked for `-progress` has written so far.
   */
  readonly run: (
    command: readonly string[],
    onEncodedMs?: (encodedMs: number) => void,
  ) => Promise<string>;
  /** How far the build really is. Reporting never fails or slows it. */
  readonly progress: (progress: RecordingBuildProgress) => void;
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
  holdPrefix: string,
  attempt: number,
): Promise<readonly CapturedPiece[]> => {
  const prefix = holdAttemptPrefix(holdPrefix, attempt);
  const entries = parseHoldPlaylist(
    await ports.hold.readText(`${prefix}${HOLD_PLAYLIST}`),
    Date.parse(ports.now()),
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
  const pieces: CapturedPiece[] = [];
  const runs = continuousRuns(entries);
  for (const [at, run] of runs.entries()) {
    const segments = segmentsSource(run, names);
    if (segments.kind !== 'segments') continue;
    const runDir = runs.length === 1 ? dir : `${dir}/run-${at + 1}`;
    await ports.files.makeDir(runDir);
    const { output, found } = await joinedSegments(
      ports,
      prefix,
      runDir,
      segments,
    );
    if (found)
      pieces.push({
        attempt,
        path: output,
        startedAtMs: segments.startedAtMs,
        durationMs: found.durationMs,
        hasAudio: found.hasAudio,
      });
  }
  return pieces;
};

/**
 * One attempt cut to what is public, to the frame. A piece wholly inside an interval
 * stays as it is, with no second encode; otherwise only the public parts survive.
 */
const publicPieces = async (
  ports: BuildPorts,
  attempt: readonly CapturedPiece[],
  intervals: readonly PublicInterval[],
): Promise<readonly CapturedPiece[]> => {
  const kept: CapturedPiece[] = [];
  for (const piece of attempt) {
    const clips = publicClips(
      [{ capturedAtMs: piece.startedAtMs, durationMs: piece.durationMs }],
      intervals,
    );
    if (clips.length === 1 && clips[0]!.durationMs === piece.durationMs) {
      kept.push(piece);
      continue;
    }
    let part = 0;
    for (const clip of clips) {
      const path = `${piece.path}.public-${(part += 1)}.mp4`;
      await ports.run(
        cutArgs(piece.path, clip.offsetMs, clip.durationMs, path),
      );
      const found = await probe(ports, path);
      if (found)
        kept.push({
          attempt: piece.attempt,
          path,
          startedAtMs: clip.capturedAtMs,
          durationMs: found.durationMs,
          hasAudio: found.hasAudio,
        });
    }
  }
  return kept;
};

/** ffmpeg's own count of what it has written, held to the length it is writing. */
const encodingProgress =
  (ports: BuildPorts, step: 'composing' | 'encoding', totalMs: number) =>
  (encodedMs: number) =>
    ports.progress({
      step,
      done: Math.min(encodedMs, totalMs),
      total: totalMs,
    });

const buildDownload = async (
  ports: BuildPorts,
  coverage: Coverage,
  output: string,
) => {
  const [only] = coverage.parts;
  if (coverage.parts.length === 1 && only?.kind === 'media')
    await ports.run(remuxArgs(only.piece.path, output));
  else
    await ports.run(
      joinTimelineArgs(coverage.parts, ports.slatePath, output),
      encodingProgress(ports, 'composing', coverage.durationMs),
    );
  const found = await probe(ports, output);
  if (!found) throw new RecordingVerificationError('download_unreadable');
  return found;
};

const buildHls = async (
  ports: BuildPorts,
  input: string,
  dir: string,
  durationMs: number,
) => {
  for (const { name } of RECORDING_RENDITIONS)
    await ports.files.makeDir(`${dir}/${name}`);
  await ports.run(
    hlsArgs(input, dir),
    encodingProgress(ports, 'encoding', durationMs),
  );
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
    readonly publicIntervals: readonly PublicInterval[];
  },
): Promise<RecordingJobState> => {
  const pieces: CapturedPiece[] = [];
  for (let attempt = 1; attempt <= job.attemptCount; attempt += 1) {
    ports.progress({
      step: 'reading',
      done: attempt - 1,
      total: job.attemptCount,
    });
    pieces.push(
      ...(await publicPieces(
        ports,
        await readAttempt(ports, job.holdPrefix, attempt),
        job.publicIntervals,
      )),
    );
  }
  const coverage = coverageOf(pieces, job.publicIntervals);
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
  await buildHls(ports, downloadPath, hlsDir, download.durationMs);

  const local = await ports.files.list(outDir);
  const written = new Map(
    [...local].map(([name, size]) => [`${root}${name}`, size] as const),
  );
  let uploaded = 0;
  for (const name of local.keys()) {
    ports.progress({ step: 'uploading', done: uploaded, total: local.size });
    await ports.recordings.upload(`${root}${name}`, `${outDir}/${name}`);
    uploaded += 1;
  }
  ports.progress({ step: 'verifying', done: 0, total: 1 });
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
