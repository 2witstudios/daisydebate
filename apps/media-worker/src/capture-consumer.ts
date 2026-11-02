import { isTransientProviderFailure, type OpenRouter } from '@daisy/ai-voice';
import type { CutClip } from './capture-clips';
import { isTransientControlFailure } from '@daisy/media/worker';
import { CAPTURE_OUTAGE_BUDGET_MS } from './capture-memory';
import {
  contained,
  observedWindow,
  readCaptureHistory,
  type CaptureClient,
  type CaptureState,
  type FrameWindow,
} from './capture-history';
export type QueuedClip = CutClip & { readonly bytes: number };
export async function consumeCaptureClips(input: {
  readonly client: CaptureClient;
  readonly epoch: number;
  readonly voice: Pick<OpenRouter, 'transcribe'>;
  readonly sttModel: string;
  readonly signal: AbortSignal;
  readonly nowMs: () => number;
  readonly waitUntilMs: (due: number, signal: AbortSignal) => Promise<void>;
  readonly take: () => QueuedClip | undefined;
  /** Edge-straddling frames seen on a track (capture-staging). */
  readonly straddles: (trackId: string) => readonly FrameWindow[];
  readonly dropped: (n: number) => void;
  /** A clip within its grant was heard, then lost before it could be committed. */
  readonly lost: (clip: QueuedClip) => void;
  readonly transcribed: () => void;
  readonly committed: (clip: QueuedClip) => void;
  /** The clip left the pipeline: transcribed and observed, or dropped. */
  readonly settled: (clip: QueuedClip) => void;
}) {
  const failed = new Set<string>();
  while (!input.signal.aborted) {
    const clip = input.take();
    if (!clip) {
      await input.waitUntilMs(input.nowMs() + 25, input.signal);
      continue;
    }
    try {
      await consumeClip(input, clip, failed);
    } catch (error) {
      // Heard, and stopped before it committed.
      input.lost(clip);
      throw error;
    } finally {
      input.settled(clip);
    }
  }
}

/** Pauses before each retry of a transcription that may still succeed. */
const STT_RETRY_DELAYS_MS = [500, 1000, 2000];
const streamOf = (clip: QueuedClip) =>
  JSON.stringify([clip.segmentId, clip.roundParticipantId]);
/**
 * One clip's transcription, scoped to that clip (VIDEO-4.1-r8). A failure that
 * may clear (a timeout, rate limit, server failure, unreachable vendor) is
 * retried through bounded pauses; a definite refusal fails that clip's stream,
 * whose later clips are then dropped unsent. Either way the frames are dropped:
 * the stream stays honestly partial (DEC-208) and the session and every other
 * stream keep going. Only the session's own cancellation ends the consumer.
 */
async function transcribeClip(
  input: Parameters<typeof consumeCaptureClips>[0],
  clip: Extract<QueuedClip, { readonly kind: 'audible' }>,
  failed: Set<string>,
) {
  if (failed.has(streamOf(clip))) return null;
  for (let attempt = 0; ; attempt++) {
    try {
      return await input.voice.transcribe({
        model: input.sttModel,
        audioBase64: Buffer.from(clip.wav).toString('base64'),
        format: 'wav',
        signal: input.signal,
      });
    } catch (error) {
      input.signal.throwIfAborted();
      const pause = STT_RETRY_DELAYS_MS[attempt];
      if (!isTransientProviderFailure(error)) failed.add(streamOf(clip));
      if (pause === undefined || failed.has(streamOf(clip))) return null;
      await input.waitUntilMs(input.nowMs() + pause, input.signal);
    }
  }
}

async function consumeClip(
  input: Parameters<typeof consumeCaptureClips>[0],
  clip: QueuedClip,
  failed: Set<string>,
) {
  const fresh = await readCaptureHistory(
    input.client,
    input.epoch,
    input.signal,
    input,
    clip.segmentId,
  );
  const allowed = contained(fresh.state, clip.roundParticipantId, {
    beforeMs: Date.parse(clip.before),
    afterMs: Date.parse(clip.after),
  });
  if (!allowed || Date.parse(clip.after) > Date.parse(fresh.state.serverNow)) {
    input.dropped(clip.durationMs / 10);
    // Outside its grant it was never owed; inside it, it was heard and lost.
    if (allowed) input.lost(clip);
    return;
  }
  if (clip.kind === 'audible') {
    const result = await transcribeClip(input, clip, failed);
    input.signal.throwIfAborted();
    if (!result) {
      input.dropped(clip.durationMs / 10);
      input.lost(clip);
      return;
    }
    input.transcribed();
    if (result.text) await appendClip(input, clip, result.text);
  }
  // A heard window is captured coverage, whether or not it held words.
  const window = clipObservation(
    fresh.state,
    clip,
    input.straddles(clip.trackId),
  );
  await untilAnswered(input, () =>
    input.client.observe(
      {
        epoch: input.epoch,
        segmentId: clip.segmentId,
        roundParticipantId: clip.roundParticipantId,
        trackId: clip.trackId,
        observedFrom: new Date(window.fromMs).toISOString(),
        observedUntil: new Date(window.untilMs).toISOString(),
      },
      input.signal,
    ),
  );
}

/** The clip's window within its fresh grant, extended to an edge only by contiguous evidence. */
function clipObservation(
  state: CaptureState,
  clip: QueuedClip,
  straddles: readonly FrameWindow[],
) {
  const beforeMs = Date.parse(clip.before),
    afterMs = Date.parse(clip.after);
  // contained() admitted the clip, so exactly one grant of its seat holds it.
  const grant = state.intervals.find(
    (i) =>
      i.roundParticipantId === clip.roundParticipantId &&
      Date.parse(i.startedAt) <= beforeMs &&
      (i.endedAt === null || afterMs < Date.parse(i.endedAt)),
  )!;
  const firstNominalMs =
    Date.parse(state.segment!.startedAt) + clip.startOffsetMs;
  return observedWindow({
    clip: {
      firstNominalMs,
      lastNominalMs: firstNominalMs + clip.durationMs - 10,
    },
    grant: {
      startMs: Date.parse(grant.startedAt),
      endMs: grant.endedAt === null ? null : Date.parse(grant.endedAt),
    },
    straddles,
  });
}

/** How soon a write the control plane could not answer is sent again. */
const WRITE_RETRY_MS = 250;
/**
 * A write stays pending in memory until the server answers. Still refused for
 * now at the outage budget, its failure ends the consumer and so the session,
 * which logs and relaunches: the server can keep refusing for good, and every
 * later clip waits behind this one.
 */
async function untilAnswered(
  input: Pick<
    Parameters<typeof consumeCaptureClips>[0],
    'signal' | 'nowMs' | 'waitUntilMs'
  >,
  write: () => Promise<unknown>,
) {
  const giveUpAt = input.nowMs() + CAPTURE_OUTAGE_BUDGET_MS;
  for (;;) {
    try {
      await write();
      return;
    } catch (error) {
      input.signal.throwIfAborted();
      if (!isTransientControlFailure(error) || input.nowMs() >= giveUpAt)
        throw error;
      await input.waitUntilMs(input.nowMs() + WRITE_RETRY_MS, input.signal);
    }
  }
}

async function appendClip(
  input: Pick<
    Parameters<typeof consumeCaptureClips>[0],
    'client' | 'epoch' | 'signal' | 'committed' | 'nowMs' | 'waitUntilMs'
  >,
  clip: QueuedClip,
  text: string,
) {
  const payload = {
    epoch: input.epoch,
    segmentId: clip.segmentId,
    roundParticipantId: clip.roundParticipantId,
    trackId: clip.trackId,
    startOffsetMs: clip.startOffsetMs,
    durationMs: clip.durationMs,
    before: clip.before,
    after: clip.after,
    text,
  };
  // Retry preserves the exact captured result and durable dedupe identity.
  await untilAnswered(input, () => input.client.append(payload, input.signal));
  input.committed(clip);
}
