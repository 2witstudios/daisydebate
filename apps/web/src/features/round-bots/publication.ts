import { createAudioPublication } from '@daisy/media/audio';
import { createPacedAudioWriter } from '@daisy/media/publication';
import type { Database } from '@daisy/db';
import type { BotPublicationScope } from '@daisy/db/bot-publication';
import { createAppError } from '@daisy/errors';

type Job = {
  readonly scope: BotPublicationScope;
  readonly token: string;
  readonly phraseId: string;
  readonly text: string;
  readonly pcm: Int16Array;
  readonly sampleRate: 24000;
  readonly channels: 1;
  /** The segment end on the database clock, when the generation read it. */
  readonly segmentEndsAt?: string;
};
const FRAME_SAMPLES = 240;
/**
 * TTS audio in whole 10 ms frames: a partial last frame is padded with
 * silence, never dropped, so every phrase is sent whole (ISSUE-454).
 */
function wholeFrames(pcm: Int16Array) {
  const tail = pcm.length % FRAME_SAMPLES;
  if (tail === 0) return pcm;
  const padded = new Int16Array(pcm.length + FRAME_SAMPLES - tail);
  padded.set(pcm);
  return padded;
}
/** Native receipt windows authorize each whole frame sent; no text is credited. */
export function createBotPublisher(input: {
  readonly store: Pick<Database, 'databaseNow' | 'verifyRoundBotPublication'>;
  readonly botToken: (
    scope: BotPublicationScope,
    token: string,
  ) => Promise<{ url: string; token: string }>;
  readonly monotonicNowMs: () => number;
  readonly waitUntilMs: (due: number, signal: AbortSignal) => Promise<void>;
}) {
  return async (
    job: Job,
    signal: AbortSignal,
    onSent?: (samples: number) => void,
  ) => {
    if (
      !(job.pcm instanceof Int16Array) ||
      job.sampleRate !== 24000 ||
      job.channels !== 1 ||
      job.pcm.length === 0 ||
      job.pcm.length > 24000 * 60
    )
      throw createAppError('VALIDATION');
    if (signal.aborted) throw createAppError('CONFLICT');
    await input.store.verifyRoundBotPublication(job.scope, job.token);
    const originalSamples = job.pcm.length;
    const frames = wholeFrames(job.pcm);
    const transportSamples = frames.length;
    const grant = await input.botToken(job.scope, job.token);
    if (signal.aborted) throw createAppError('CONFLICT');
    const publication = await createAudioPublication({
      url: grant.url,
      token: grant.token,
      trackName: job.phraseId,
      sampleRate: job.sampleRate,
      channels: job.channels,
      monotonicNowMs: input.monotonicNowMs,
    });
    const write = createPacedAudioWriter({
      publication,
      sampleRate: job.sampleRate,
      channels: job.channels,
      // One union window per 100 ms (DEC-212): about 10 transactions a second.
      framesPerAuthorization: 10,
      ...(job.segmentEndsAt
        ? { segmentEndsAtMs: Date.parse(job.segmentEndsAt) }
        : {}),
      nowMs: input.monotonicNowMs,
      waitUntilMs: input.waitUntilMs,
      refreshAfterMs: 15000,
      calibrate: async () => {
        const sentAtMs = input.monotonicNowMs();
        const serverNowMs = Date.parse(await input.store.databaseNow());
        const receivedAtMs = input.monotonicNowMs();
        return { sentAtMs, receivedAtMs, serverNowMs, precisionMs: 1 };
      },
      authorizeWindow: async (window) => {
        await input.store.verifyRoundBotPublication(job.scope, job.token, {
          beforeMs: Date.parse(window.before),
          afterMs: Date.parse(window.after),
        });
        return true;
      },
      // Resume follows what was heard, not what was credited (ISSUE-431-r7),
      // capped at the phrase: the padded tail is silence (ISSUE-454).
      onSent: (sentSamples) =>
        onSent?.(Math.min(originalSamples, sentSamples * job.channels)),
    });
    const result = await write(frames, signal);
    return {
      originalSamples,
      transportSamples,
      eligibleSamples: result.eligibleSamples,
      complete: result.complete,
    };
  };
}
