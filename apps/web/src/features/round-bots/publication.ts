import type { createAudioPublication } from '@daisy/media/audio';
import { createPacedAudioWriter } from '@daisy/media/publication';
import type { Database } from '@daisy/db';
import type { BotPublicationScope } from '@daisy/db/bot-publication';
import { createAppError } from '@daisy/errors';

type Publication = Awaited<ReturnType<typeof createAudioPublication>>;
/** One synthesized bot phrase, bound to its publication scope and token. */
export type BotSpeechJob = {
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
/**
 * One claim's native publication: joined when the claim starts, ahead of its
 * speech, so capture subscribes to the track once and early, and reused by
 * every attempt, so a retry never joins a fresh participant whose first
 * frames no one has subscribed to yet (ISSUE-514-r1, DEC-225). A publication
 * that failed is closed and replaced on the next use; `close` ends it with
 * the claim.
 */
function createClaimPublication(input: {
  readonly open: () => Promise<Publication>;
}) {
  let current: Promise<Publication> | null = null;
  let closed = false;
  const release = async (opening: Promise<Publication> | null) => {
    const publication = await opening?.catch(() => null);
    await publication?.close();
  };
  const open = () => {
    const opening = input.open();
    current = opening;
    // A failed join holds no participant; the next use joins again.
    opening.catch(() => {
      if (current === opening) current = null;
    });
    return opening;
  };
  const live = async (opening: Promise<Publication>) => {
    const publication = await opening;
    if (!closed) return publication;
    await publication.close();
    throw createAppError('CONFLICT');
  };
  return {
    /** Joins ahead of speech; a failure here is retried by `use`. */
    start: () => {
      if (!closed && !current) open().catch(() => undefined);
    },
    /** The claim's publication, replacing one that failed once per use. */
    use: async () => {
      if (closed) throw createAppError('CONFLICT');
      const early = current;
      // A failed early join is retried once here, not reported as speech.
      const publication = early
        ? await live(early).catch((error: unknown) => {
            if (closed) throw error;
            return live(open());
          })
        : await live(open());
      if (publication.usable()) return publication;
      await publication.close();
      if (closed) throw createAppError('CONFLICT');
      return live(open());
    },
    close: async () => {
      closed = true;
      const last = current;
      current = null;
      await release(last);
    },
  };
}
/**
 * A claim's publisher: native receipt windows authorize each whole frame
 * sent; no text is credited.
 */
export function createBotPublisher(input: {
  readonly store: Pick<Database, 'databaseNow' | 'verifyRoundBotPublication'>;
  readonly botToken: (
    scope: BotPublicationScope,
    token: string,
  ) => Promise<{ url: string; token: string }>;
  readonly connect: typeof createAudioPublication;
  readonly nextId: () => string;
  readonly monotonicNowMs: () => number;
  readonly waitUntilMs: (due: number, signal: AbortSignal) => Promise<void>;
}) {
  return (claim: {
    readonly scope: BotPublicationScope;
    readonly token: string;
  }) => {
    const publication = createClaimPublication({
      open: async () => {
        await input.store.verifyRoundBotPublication(claim.scope, claim.token);
        const grant = await input.botToken(claim.scope, claim.token);
        return input.connect({
          url: grant.url,
          token: grant.token,
          trackName: input.nextId(),
          sampleRate: 24000,
          channels: 1,
          monotonicNowMs: input.monotonicNowMs,
        });
      },
    });
    const publish = async (
      job: BotSpeechJob,
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
      const native = await publication.use();
      if (signal.aborted) throw createAppError('CONFLICT');
      const write = createPacedAudioWriter({
        publication: native,
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
        segmentEnded: result.segmentEnded,
        stop: result.stop,
      };
    };
    return {
      /** Joins the Room ahead of speech. */
      start: publication.start,
      publish,
      /** Ends the claim's publication; every later publish is refused. */
      close: publication.close,
    };
  };
}
