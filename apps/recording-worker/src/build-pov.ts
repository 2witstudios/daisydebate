import {
  povHoldPrefix,
  povObjectKey,
  type PovBuild,
  type PublicInterval,
  type RecordingPov,
} from '@daisy/protocol';
import { probeMedia, readAttempt } from './attempt-media';
import type { BuildPorts } from './build-ports';
import type { CapturedPiece } from './coverage';
import { povAudioArgs, povTimelineArgs } from './pov-commands';
import { povTimeline } from './pov-timeline';

/** Encoders round durations; anything past this is media gone missing. */
const DURATION_TOLERANCE_MS = 1000;
/** A blip in the bucket or a disk is worth one more go; the raw goes once this ends. */
const TRIES = 2;

type Frame = { readonly fromMs: number; readonly durationMs: number };

const readPieces = async (
  ports: BuildPorts,
  recordingId: string,
  pov: PovBuild,
  workDir: string,
): Promise<readonly CapturedPiece[]> => {
  const scoped = { ...ports, workDir };
  const holdPrefix = povHoldPrefix(recordingId, pov.roundParticipantId);
  const pieces: CapturedPiece[] = [];
  for (let attempt = 1; attempt <= pov.attemptCount; attempt += 1)
    pieces.push(...(await readAttempt(scoped, holdPrefix, attempt)));
  return pieces;
};

/** One file: uploaded, then read back at the size written and the length expected. */
const stored = async (
  ports: BuildPorts,
  key: string,
  path: string,
  expectedMs: number,
) => {
  const found = await probeMedia(ports, path);
  if (
    found === null ||
    Math.abs(found.durationMs - expectedMs) > DURATION_TOLERANCE_MS
  )
    throw new Error('pov_duration');
  await ports.recordings.upload(key, path);
  const local = await ports.files.list(path.slice(0, path.lastIndexOf('/')));
  const byteSize = local.get(path.slice(path.lastIndexOf('/') + 1));
  const remote = (
    await ports.recordings.sizes(key.slice(0, key.lastIndexOf('/') + 1))
  ).get(key);
  if (!byteSize || remote !== byteSize) throw new Error('pov_mismatch');
  return { key, byteSize };
};

const buildOne = async (
  ports: BuildPorts,
  input: {
    readonly recordingId: string;
    readonly pov: PovBuild;
    readonly intervals: readonly PublicInterval[];
    readonly frame: Frame;
    readonly withinMs: number;
    readonly workDir: string;
  },
): Promise<RecordingPov> => {
  const { recordingId, pov, frame, workDir, withinMs } = input;
  const seat = pov.roundParticipantId;
  const missing = (reason: 'never_captured' | 'nothing_public') =>
    ({ status: 'missing', roundParticipantId: seat, reason }) as const;
  if (pov.attemptCount === 0) return missing('never_captured');
  await ports.files.makeDir(workDir);
  const timeline = povTimeline(
    await readPieces(ports, recordingId, pov, workDir),
    input.intervals,
    frame,
  );
  if (timeline === null) return missing('nothing_public');
  const outDir = `${workDir}/out`;
  await ports.files.makeDir(outDir);
  const audioPath = `${outDir}/audio.m4a`;
  const key = (kind: 'video' | 'audio') =>
    povObjectKey(recordingId, seat, kind);
  const { picture } = pov;
  const encode = (output: string) =>
    ports.run(
      povTimelineArgs(timeline.parts, ports.slatePath, output, picture),
      undefined,
      withinMs,
    );
  const expectedMs = frame.durationMs;
  let video = null;
  if (picture === null) await encode(audioPath);
  else {
    const videoPath = `${outDir}/video.mp4`;
    await encode(videoPath);
    await ports.run(povAudioArgs(videoPath, audioPath));
    video = {
      ...(await stored(ports, key('video'), videoPath, expectedMs)),
      quality: picture,
    };
  }
  return {
    status: 'built',
    roundParticipantId: seat,
    video,
    audio: await stored(ports, key('audio'), audioPath, expectedMs),
    durationMs: expectedMs,
    gaps: [...timeline.gaps],
  };
};

/**
 * Each debater's own files, one after another, on the composite's timeline. A failure
 * costs that one debater and is said out loud: the Recording is still ready, listing
 * them as missing. The run's remaining time is shared out, so a slow view is stopped
 * while the composite's build can still finish, never the other way round.
 */
export const buildPovs = async (
  ports: BuildPorts,
  job: {
    readonly recordingId: string;
    readonly povs: readonly PovBuild[];
    readonly intervals: readonly PublicInterval[];
    readonly frame: Frame;
    readonly budgetMs: number;
  },
): Promise<readonly RecordingPov[]> => {
  const startedAtMs = Date.parse(ports.now());
  const built: RecordingPov[] = [];
  for (const [index, pov] of job.povs.entries()) {
    ports.progress({ step: 'povs', done: index, total: job.povs.length });
    const leftMs = job.budgetMs - (Date.parse(ports.now()) - startedAtMs);
    let result: RecordingPov = {
      status: 'missing',
      roundParticipantId: pov.roundParticipantId,
      reason: 'build_failed',
    };
    const withinMs = Math.floor(leftMs / (job.povs.length - index) / TRIES);
    for (let tries = 0; tries < TRIES && withinMs > 0; tries += 1) {
      try {
        result = await buildOne(ports, {
          recordingId: job.recordingId,
          pov,
          intervals: job.intervals,
          frame: job.frame,
          withinMs,
          workDir: `${ports.workDir}/pov-${index}-${tries}`,
        });
        break;
      } catch {
        // The next try starts over, and the last leaves this debater missing.
      }
    }
    if (result.status === 'missing' && result.reason === 'build_failed')
      ports.povMissing();
    built.push(result);
  }
  return built;
};
