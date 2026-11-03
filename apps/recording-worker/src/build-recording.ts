import {
  type BuiltRecordingMedia,
  type PovBuild,
  type RecordingBuildProgress,
  type RecordingJobState,
  publicClips,
  recordingBuildCeilingMs,
  type PublicInterval,
} from '@daisy/protocol';
import { probe, readAttempt } from './attempt-media';
import type { BuildPorts } from './build-ports';
import { buildPovs } from './build-pov';
import { coverageOf, type CapturedPiece, type Coverage } from './coverage';
import {
  cutArgs,
  hlsArgs,
  joinTimelineArgs,
  recordingMasterPlaylist,
  RECORDING_RENDITIONS,
  remuxArgs,
} from './media-commands';
import { verificationProblem } from './verify';

/** The stored media did not match what was built: nothing false may become ready. */
export class RecordingVerificationError extends Error {}

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
    /** Each debater's own capture; a failure in one costs only that one. */
    readonly povs: readonly PovBuild[];
    readonly ceilingMs?: number | undefined;
  },
): Promise<RecordingJobState> => {
  const startedAtMs = Date.parse(ports.now());
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
  const povs = await buildPovs(ports, {
    recordingId: job.recordingId,
    povs: job.povs,
    intervals: job.publicIntervals,
    frame: { fromMs: coverage.capturedFromMs, durationMs: coverage.durationMs },
    budgetMs:
      (job.ceilingMs ?? recordingBuildCeilingMs(coverage.durationMs)) -
      (Date.parse(ports.now()) - startedAtMs),
  });
  const media: BuiltRecordingMedia = {
    capturedFrom: new Date(coverage.capturedFromMs).toISOString(),
    playlistKey: `${hlsRoot}master.m3u8`,
    downloadKey,
    durationMs: download.durationMs,
    byteSize:
      [...written.values()].reduce((sum, size) => sum + size, 0) +
      povs.reduce(
        (sum, pov) =>
          pov.status === 'built'
            ? sum + pov.audio.byteSize + (pov.video?.byteSize ?? 0)
            : sum,
        0,
      ),
    verifiedAt: ports.now(),
    gaps: [...coverage.gaps],
    ...(povs.length > 0 ? { povs: [...povs] } : {}),
  };
  return { status: 'built', media };
};
