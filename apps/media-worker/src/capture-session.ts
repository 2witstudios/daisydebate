import { createAppError } from '@daisy/errors';
import type { OpenRouter } from '@daisy/ai-voice';
import { createCaptureSubscription } from '@daisy/media/capture';
import { createClipQueue } from './clip-queue';
import { readCaptureHistory, type CaptureClient } from './capture-history';
import { createCaptureStaging } from './capture-staging';
import { validateCaptureBatch } from './capture-batch';
import { activityBatches } from './capture-activity';
import { consumeCaptureClips, type QueuedClip } from './capture-consumer';
import { createStreamTracker } from './capture-streams';
type Dependencies = {
  readonly roundId: string;
  readonly client: CaptureClient;
  readonly voice: Pick<OpenRouter, 'transcribe'>;
  readonly sttModel: string;
  readonly nowMs: () => number;
  readonly waitUntilMs: (due: number, signal: AbortSignal) => Promise<void>;
};
/** Assigned session only. Discovery and process isolation live at the deployment edge. */
export async function runCaptureSession(
  input: Dependencies,
  caller: AbortSignal,
) {
  const stop = new AbortController(),
    signal = AbortSignal.any([caller, stop.signal]);
  const stats = {
    stagedFrames: 0,
    droppedFrames: 0,
    transcribedClips: 0,
    appendedChunks: 0,
    sealedStreams: 0,
    relayedBatches: 0,
  };
  const dropped = (n: number) => {
    stats.droppedFrames += n;
  };
  const lease = await input.client.lease(15000, signal),
    epoch = lease.epoch;
  let current = await readCaptureHistory(input.client, epoch, signal),
    nextRenewal = input.nowMs() + 5000;
  const token = await input.client.token(epoch, signal);
  const staging = createCaptureStaging({
    current: () => current,
    nowMs: input.nowMs,
    dropped,
    retained: () => {
      stats.stagedFrames++;
    },
  });
  const queue = createClipQueue<QueuedClip>({
    maxClips: 10,
    maxBytes: 20 * 1024 * 1024,
    maxDurationMs: 120000,
  });
  const streams = createStreamTracker(16384);
  streams.remember(current.state);
  const capture = await createCaptureSubscription({
    url: token.url,
    token: token.token,
    identities: identities(current),
    nowMs: input.nowMs,
    onFrame: (raw) => {
      if (!signal.aborted) staging.observe(raw);
    },
    onTrackClosed: (track) => staging.closeTrack(track.trackId),
  });
  void capture.closed.then(
    () => stop.abort(),
    () => stop.abort(),
  );
  let failure: unknown;
  const consuming = consumeCaptureClips({
    ...input,
    epoch,
    signal,
    take: queue.shift,
    dropped,
    transcribed: () => {
      stats.transcribedClips++;
    },
    committed: (clip) => {
      streams.forClip(clip).count++;
      stats.appendedChunks++;
    },
  }).catch((error) => {
    if (!signal.aborted) {
      failure = error;
      stop.abort();
    }
  });
  try {
    while (!signal.aborted) {
      const due = input.nowMs() + 250;
      if (input.nowMs() >= nextRenewal) {
        const renewed = await input.client.lease(15000, signal);
        if (renewed.epoch !== epoch)
          throw createAppError('CONFLICT', 'Capture epoch changed');
        nextRenewal = input.nowMs() + 5000;
      }
      current = await readCaptureHistory(input.client, epoch, signal);
      streams.remember(current.state);
      staging.refresh(current.calibration);
      await capture.setIdentities(identities(current));
      const frames = staging.take();
      stats.relayedBatches += await relayActivity(
        input.client,
        epoch,
        frames,
        signal,
      );
      await validateCaptureBatch({
        ...input,
        current,
        epoch,
        signal,
        frames,
        dropped,
        clip: (clip) => {
          const queued = { ...clip, bytes: clip.wav.byteLength };
          streams.forClip(queued);
          for (const discarded of queue.push(queued))
            dropped(discarded.durationMs / 10);
        },
      });
      await input.waitUntilMs(due, signal);
    }
  } catch (error) {
    if (!caller.aborted) failure = error;
  } finally {
    stop.abort();
    await capture.close();
    await consuming;
    staging.clear();
    queue.clear();
    stats.sealedStreams = await sealCaptureStreams(
      input.client,
      epoch,
      streams.values(),
    );
  }
  if (failure)
    throw createAppError(
      'INFRASTRUCTURE',
      'Capture session ended before safe completion',
    );
  return stats;
}
const identities = (snapshot: Awaited<ReturnType<CaptureClient['read']>>) =>
  snapshot.state.participants.flatMap((p) => (p.identity ? [p.identity] : []));
/** Heuristic only: a refused or lost batch is unknown activity, never a capture failure. */
async function relayActivity(
  client: CaptureClient,
  epoch: number,
  frames: Parameters<typeof activityBatches>[0],
  signal: AbortSignal,
) {
  const results = await Promise.allSettled(
    activityBatches(frames).map((batch) =>
      client.activity({ epoch, ...batch }, signal),
    ),
  );
  return results.filter((r) => r.status === 'fulfilled').length;
}
async function sealCaptureStreams(
  client: CaptureClient,
  epoch: number,
  streams: Iterable<{
    segmentId: string;
    roundParticipantId: string;
    count: number;
  }>,
) {
  let sealed = 0;
  const deadline = AbortSignal.timeout(10000);
  for (const stream of streams) {
    try {
      await client.seal(
        {
          epoch,
          segmentId: stream.segmentId,
          roundParticipantId: stream.roundParticipantId,
          expectedChunkCount: stream.count,
        },
        deadline,
      );
      sealed++;
    } catch {
      /* Cutoff/freeze or an open grant remains truthfully unsealed. */
    }
  }
  return sealed;
}
