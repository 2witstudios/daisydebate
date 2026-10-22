import type { OpenRouter } from '@daisy/ai-voice';
import type { cutCaptureClips } from '@daisy/media/clips';
import {
  contained,
  readCaptureHistory,
  type CaptureClient,
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
    if (!result.text) {
      input.dropped(clip.durationMs / 10);
      continue;
    }
    const payload = {
      epoch: input.epoch,
      segmentId: clip.segmentId,
      roundParticipantId: clip.roundParticipantId,
      trackId: clip.trackId,
      startOffsetMs: clip.startOffsetMs,
      durationMs: clip.durationMs,
      before: clip.before,
      after: clip.after,
      text: result.text,
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
}
