import type { OpenRouter } from '@daisy/ai-voice';
import type { cutCaptureClips } from '@daisy/media/clips';
import {
  contained,
  observedWindow,
  readCaptureHistory,
  type CaptureClient,
  type CaptureState,
  type FrameWindow,
} from './capture-history';
export type QueuedClip = ReturnType<typeof cutCaptureClips>['clips'][number] & {
  readonly bytes: number;
};
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
  readonly transcribed: () => void;
  readonly committed: (clip: QueuedClip) => void;
}) {
  while (!input.signal.aborted) {
    const clip = input.take();
    if (!clip) {
      await input.waitUntilMs(input.nowMs() + 25, input.signal);
      continue;
    }
    const fresh = await readCaptureHistory(
      input.client,
      input.epoch,
      input.signal,
      clip.segmentId,
    );
    if (
      !contained(fresh.state, clip.roundParticipantId, {
        beforeMs: Date.parse(clip.before),
        afterMs: Date.parse(clip.after),
      }) ||
      Date.parse(clip.after) > Date.parse(fresh.state.serverNow)
    ) {
      input.dropped(clip.durationMs / 10);
      continue;
    }
    const result = await input.voice.transcribe({
      model: input.sttModel,
      audioBase64: Buffer.from(clip.wav).toString('base64'),
      format: 'wav',
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    input.transcribed();
    // A transcribed window is captured coverage, speech or honest silence.
    if (result.text) await appendClip(input, clip, result.text);
    const window = clipObservation(
      fresh.state,
      clip,
      input.straddles(clip.trackId),
    );
    await input.client.observe(
      {
        epoch: input.epoch,
        segmentId: clip.segmentId,
        roundParticipantId: clip.roundParticipantId,
        trackId: clip.trackId,
        observedFrom: new Date(window.fromMs).toISOString(),
        observedUntil: new Date(window.untilMs).toISOString(),
      },
      input.signal,
    );
  }
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

async function appendClip(
  input: Pick<
    Parameters<typeof consumeCaptureClips>[0],
    'client' | 'epoch' | 'signal' | 'committed'
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
  try {
    await input.client.append(payload, input.signal);
  } catch {
    input.signal.throwIfAborted();
    await input.client.append(payload, input.signal);
  }
  input.committed(clip);
}
