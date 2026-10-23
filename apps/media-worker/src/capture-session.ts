import { createAppError } from '@daisy/errors';
import type { OpenRouter } from '@daisy/ai-voice';
import { createCaptureSubscription } from '@daisy/media/capture';
import { isOpenTimelineRefusal } from '@daisy/media/worker';
import { createClipQueue } from './clip-queue';
import { readCaptureHistory, type CaptureClient } from './capture-history';
import { createCaptureStaging } from './capture-staging';
import {
  CAPTURE_BATCH_INTERVAL_MS,
  validateCaptureBatch,
} from './capture-batch';
import {
  ACTIVITY_RELAY_INTERVAL_MS,
  activityWanted,
  createActivityRelay,
} from './capture-activity';
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
  const activity = createActivityRelay();
  const streams = createStreamTracker(16384);
  streams.remember(current.state);
  const capture = await createCaptureSubscription({
    url: token.url,
    token: token.token,
    identities: identities(current),
    nowMs: input.nowMs,
    onFrame: (raw) => {
      if (signal.aborted) return;
      const frame = staging.observe(raw);
      if (frame && activityWanted(current.state)) activity.observe(frame);
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
    straddles: staging.straddles,
    dropped,
    transcribed: () => {
      stats.transcribedClips++;
    },
    committed: (clip) => {
      streams.forClip(clip).count++;
      stats.appendedChunks++;
    },
    settled: streams.settled,
  }).catch((error) => {
    if (!signal.aborted) {
      failure = error;
      stop.abort();
    }
  });
  const relaying = (async () => {
    while (!signal.aborted) {
      const due = input.nowMs() + ACTIVITY_RELAY_INTERVAL_MS;
      if (activityWanted(current.state))
        stats.relayedBatches += await relayActivity(
          input.client,
          epoch,
          activity.take(),
          signal,
        );
      else activity.clear();
      await input.waitUntilMs(due, signal).catch(() => undefined);
    }
  })();
  try {
    while (!signal.aborted) {
      const due = input.nowMs() + CAPTURE_BATCH_INTERVAL_MS;
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
      await validateCaptureBatch({
        ...input,
        current,
        epoch,
        signal,
        frames: staging.take(),
        dropped,
        straddled: ({ trackId, nominalStartMs, beforeMs, afterMs }) =>
          staging.rememberEdge(trackId, { nominalStartMs, beforeMs, afterMs }),
        clip: (clip) => {
          const queued = { ...clip, bytes: clip.wav.byteLength };
          streams.queued(queued);
          for (const discarded of queue.push(queued)) {
            streams.settled(discarded);
            dropped(discarded.durationMs / 10);
          }
        },
      });
      stats.sealedStreams += await sealCaptureStreams(
        input.client,
        epoch,
        streams.due(Date.parse(current.state.serverNow)),
        signal,
        streams.finished,
      );
      await input.waitUntilMs(due, signal);
    }
  } catch (error) {
    if (!caller.aborted) failure = error;
  } finally {
    stop.abort();
    await capture.close();
    await consuming;
    await relaying;
    activity.clear();
    staging.clear();
    queue.clear();
    // Fallback for every stream not yet finished.
    stats.sealedStreams += await sealCaptureStreams(
      input.client,
      epoch,
      [...streams.values()].filter((stream) => !stream.finished),
      AbortSignal.timeout(10000),
      streams.finished,
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
  batches: ReturnType<ReturnType<typeof createActivityRelay>['take']>,
  signal: AbortSignal,
) {
  const results = await Promise.allSettled(
    batches.map((batch) => client.activity({ epoch, ...batch }, signal)),
  );
  return results.filter((r) => r.status === 'fulfilled').length;
}
/**
 * Seals each stream once. Only a seal refused for its still-open timeline stays
 * due for the next batch; a definite refusal (cutoff, freeze, chunks below the
 * stored count) finishes the stream like a seal does (VIDEO-4.1-r1).
 */
export async function sealCaptureStreams(
  client: CaptureClient,
  epoch: number,
  streams: Iterable<{
    segmentId: string;
    roundParticipantId: string;
    count: number;
  }>,
  signal: AbortSignal,
  finished: (stream: { segmentId: string; roundParticipantId: string }) => void,
) {
  let count = 0;
  for (const stream of streams) {
    try {
      await client.seal(
        {
          epoch,
          segmentId: stream.segmentId,
          roundParticipantId: stream.roundParticipantId,
          expectedChunkCount: stream.count,
        },
        signal,
      );
      finished(stream);
      count++;
    } catch (error) {
      signal.throwIfAborted();
      if (!isOpenTimelineRefusal(error)) finished(stream);
    }
  }
  return count;
}
