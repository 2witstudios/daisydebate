import { createAppError } from '@daisy/errors';
import type { OpenRouter } from '@daisy/ai-voice';
import type { createCaptureSubscription } from '@daisy/media/capture';
import { isCaptureClosedRefusal } from '@daisy/media/worker';
import { createClipQueue } from './clip-queue';
import { readCaptureHistory, type CaptureClient } from './capture-history';
import { createCaptureStaging } from './capture-staging';
import {
  CAPTURE_BATCH_INTERVAL_MS,
  flushClipCarry,
  flushQuietCarries,
  validateCaptureBatch,
  type ClipCarries,
} from './capture-batch';
import {
  ACTIVITY_RELAY_INTERVAL_MS,
  activityWanted,
  createActivityRelay,
  relayActivity,
} from './capture-activity';
import type { consumeCaptureClips, QueuedClip } from './capture-consumer';
import { createHeardReporter } from './capture-heard';
import { createStreamTracker } from './capture-streams';
import {
  closeCaptureSession,
  droppedRoomFailure,
  gracefulStop,
} from './capture-drain';
import { sealCaptureStreams } from './capture-seal';
import {
  atStage,
  tagCaptureFailure,
  type CaptureFailureStage,
} from './capture-exit';
type Dependencies = {
  readonly roundId: string;
  readonly client: CaptureClient;
  readonly voice: Pick<OpenRouter, 'transcribe'>;
  readonly sttModel: string;
  readonly nowMs: () => number;
  readonly waitUntilMs: (due: number, signal: AbortSignal) => Promise<void>;
  /** The LiveKit subscription and the clip consumer (capture-run.ts). */
  readonly subscribe: typeof createCaptureSubscription;
  readonly consume: typeof consumeCaptureClips;
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
  const lease = await atStage('lease', input.client.lease(15000, signal)),
    epoch = lease.epoch;
  let current = await atStage(
      'history',
      readCaptureHistory(input.client, epoch, signal),
    ),
    nextRenewal = input.nowMs() + 5000;
  const token = await atStage('token', input.client.token(epoch, signal));
  const staging = createCaptureStaging({
    current: () => current,
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
  const carries: ClipCarries = new Map();
  const heard = createHeardReporter({ heard: input.client.heard });
  const enqueue = (clip: QueuedClip | Omit<QueuedClip, 'bytes'>) => {
    const queued = { ...clip, bytes: clip.wav.byteLength };
    streams.queued(queued);
    for (const discarded of queue.push(queued)) {
      streams.settled(discarded);
      dropped(discarded.durationMs / 10);
    }
  };
  streams.remember(current.state);
  const capture = await atStage(
    'connect',
    input.subscribe({
      url: token.url,
      token: token.token,
      identities: identities(current),
      nowMs: input.nowMs,
      onFrame: (raw) => {
        if (signal.aborted) return;
        const frame = staging.observe(raw);
        if (frame && activityWanted(current.state)) activity.observe(frame);
      },
      onTrackStarted: heard.started,
      onTrackClosed: (track) => {
        heard.closed(track.trackId);
        staging.closeTrack(track.trackId);
      },
    }),
  );
  // The first failure wins: what it aborts then rejects only as cancelled.
  let failure: unknown;
  const record = (stage: CaptureFailureStage, error: unknown) => {
    failure ??= tagCaptureFailure(stage, error);
  };
  // A LiveKit drop stops the session; confirmDrop asks the server why.
  let roomDropped = false;
  // An abort-caused rejection is not a failure of its own.
  const loopFailed = (error: unknown) => {
    if (!caller.aborted && !stop.signal.aborted) failure ??= error;
  };
  const confirmDrop = async () => {
    if (roomDropped && failure === undefined && !caller.aborted)
      failure = await droppedRoomFailure(input.client, epoch);
  };
  void capture.closed.then(
    (reason) => {
      roomDropped = reason === 'disconnected';
      stop.abort();
    },
    (error: unknown) => {
      record('connect', error);
      stop.abort();
    },
  );
  // The consumer outlives the batch loop on a graceful stop, to drain (VIDEO-4.1-r12).
  const halt = new AbortController();
  const consuming = input
    .consume({
      ...input,
      epoch,
      signal: halt.signal,
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
    })
    .catch((error) => {
      if (!halt.signal.aborted) {
        record('transcription', error);
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
        const renewed = await atStage(
          'renewal',
          input.client.lease(15000, signal),
        );
        if (renewed.epoch !== epoch)
          throw tagCaptureFailure(
            'renewal',
            createAppError('CONFLICT', 'Capture epoch changed'),
          );
        nextRenewal = input.nowMs() + 5000;
      }
      current = await atStage(
        'refresh',
        readCaptureHistory(input.client, epoch, signal),
      );
      streams.remember(current.state);
      staging.refresh(current.calibration);
      await atStage('refresh', capture.setIdentities(identities(current)));
      await atStage('batch', heard.report(current.state, epoch, signal));
      await atStage(
        'batch',
        validateCaptureBatch({
          ...input,
          current,
          epoch,
          signal,
          frames: staging.take(),
          dropped,
          held: staging.requeue,
          straddled: ({ trackId, nominalStartMs, beforeMs, afterMs }) =>
            staging.rememberEdge(trackId, {
              nominalStartMs,
              beforeMs,
              afterMs,
            }),
          clip: enqueue,
          carries,
        }),
      );
      flushQuietCarries(
        carries,
        input.roundId,
        Date.parse(current.state.serverNow),
      ).forEach(enqueue);
      // A due stream's carried frames are its last clip; it seals once that is in.
      const sealable = streams
        .due(Date.parse(current.state.serverNow), staging.holds)
        .filter((stream) => {
          const last = flushClipCarry(carries, input.roundId, stream);
          last.forEach(enqueue);
          return last.length === 0;
        });
      stats.sealedStreams += await atStage(
        'seal',
        sealCaptureStreams(
          input.client,
          epoch,
          sealable,
          signal,
          streams.finished,
        ),
      );
      await input.waitUntilMs(due, signal);
    }
  } catch (error) {
    loopFailed(error);
  } finally {
    const graceful = gracefulStop(caller, failure, stop.signal);
    stop.abort();
    // A failing shutdown step never masks the failure that stopped the session.
    try {
      await capture.close();
      await relaying;
      activity.clear();
      staging.clear();
      stats.sealedStreams += await closeCaptureSession({
        graceful,
        carries,
        roundId: input.roundId,
        enqueue,
        inFlight: () =>
          [...streams.values()].reduce((sum, s) => sum + s.pending, 0),
        halt: () => halt.abort(),
        consuming,
        discardQueued: () => {
          let frames = 0;
          for (let clip = queue.shift(); clip; clip = queue.shift()) {
            streams.settled(clip);
            frames += clip.durationMs / 10;
          }
          return frames;
        },
        dropped,
        // Fallback for every stream not yet finished.
        seal: (cleanup) =>
          sealCaptureStreams(
            input.client,
            epoch,
            [...streams.values()].filter((stream) => !stream.finished),
            cleanup,
            streams.finished,
          ),
        nowMs: input.nowMs,
        waitUntilMs: input.waitUntilMs,
      });
    } catch (error) {
      record('shutdown', error);
    }
  }
  await confirmDrop();
  // The server closed the capture for good: a normal end, not a failure.
  if (failure && isCaptureClosedRefusal(failure))
    return { ...stats, closed: true };
  if (failure)
    throw createAppError(
      'INFRASTRUCTURE',
      'Capture session ended before safe completion',
      failure,
    );
  return { ...stats, closed: false };
}
const identities = (snapshot: Awaited<ReturnType<CaptureClient['read']>>) =>
  snapshot.state.participants.flatMap((p) => (p.identity ? [p.identity] : []));
