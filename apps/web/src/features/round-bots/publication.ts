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
};
/** Native receipt windows authorize only the original whole-frame prefix; no text is credited. */
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
    const transportSamples = originalSamples - (originalSamples % 240);
    if (!transportSamples)
      return {
        originalSamples,
        transportSamples,
        eligibleSamples: 0,
        complete: false,
      };
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
      // Resume follows what was heard, not what was credited (ISSUE-431-r7).
      onSent: (sentSamples) => onSent?.(sentSamples * job.channels),
    });
    const result = await write(job.pcm.subarray(0, transportSamples), signal);
    return {
      originalSamples,
      transportSamples,
      eligibleSamples: result.eligibleSamples,
      complete: result.complete && transportSamples === originalSamples,
    };
  };
}
