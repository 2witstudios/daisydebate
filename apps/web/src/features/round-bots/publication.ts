import type { createAudioPublication } from '@daisy/media/audio';
import { createStreamingAudioWriter } from '@daisy/media/publication';
import type { Database } from '@daisy/db';
import type { BotPublicationScope } from '@daisy/db/bot-publication';
import { spokenPrefix } from '@daisy/debate-engine';
import { createAppError, isAppError } from '@daisy/errors';

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
};
const FRAME_SAMPLES = 240;
const SAMPLE_RATE = 24000;
/** How far ahead of playout frames are handed to the native queue. */
const LEAD_MS = 100;
/** The native queue: comfortably above the lead, so a handoff never waits. */
const QUEUE_MS = 500;
/**
 * How often a playing phrase re-reads its floor, beside the audio: a lost
 * floor, a changed segment or an incident stops it within about this long.
 */
const FLOOR_WATCH_MS = 250;
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
 * the claim, abandoning a join still in progress.
 */
function createClaimPublication(input: {
  readonly open: (signal: AbortSignal) => Promise<Publication>;
  /** Its session left the room it joined, so it hears nobody however well it runs. */
  readonly roomLeft: () => boolean;
}) {
  let current: Promise<Publication> | null = null;
  let closed = false;
  const ended = new AbortController();
  const release = async (opening: Promise<Publication> | null) => {
    const publication = await opening?.catch(() => null);
    await publication?.close();
  };
  const open = () => {
    const opening = input.open(ended.signal);
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
      if (publication.usable() && !input.roomLeft()) return publication;
      await publication.close();
      if (closed) throw createAppError('CONFLICT');
      return live(open());
    },
    close: async () => {
      closed = true;
      ended.abort();
      const last = current;
      current = null;
      await release(last);
    },
  };
}
/** How a published phrase ended: played whole, cut at the segment end, or stopped. */
export type PhraseOutcome = {
  readonly complete: boolean;
  /** It reached the speech's hard stop: the segment is over for this bot. */
  readonly segmentEnded: boolean;
};
/**
 * A claim's publisher (ADR 0122). Each phrase streams in real time into a
 * buffered native source while its authored utterance is written beside it,
 * never in front of it: a refusal of that write stops the audio at the next
 * frame, and a phrase cut short keeps only the words that played. A speech
 * stops locally at its segment's due time, calibrated once per speech, so no
 * audio plays past the cutoff and no text is credited past it.
 */
export function createBotPublisher(input: {
  readonly store: Pick<
    Database,
    | 'databaseNow'
    | 'verifyRoundBotPublication'
    | 'beginRoundBotPhrase'
    | 'endRoundBotPhrase'
  >;
  readonly botToken: (
    scope: BotPublicationScope,
    token: string,
  ) => Promise<{ url: string; token: string; roomName: string }>;
  readonly connect: typeof createAudioPublication;
  readonly nextId: () => string;
  readonly monotonicNowMs: () => number;
  readonly waitUntilMs: (due: number, signal: AbortSignal) => Promise<void>;
}) {
  return (claim: {
    readonly scope: BotPublicationScope;
    readonly token: string;
  }) => {
    let room: string | undefined;
    let roomLeft = false;
    const publication = createClaimPublication({
      roomLeft: () => roomLeft,
      open: async () => {
        await input.store.verifyRoundBotPublication(claim.scope, claim.token);
        const grant = await input.botToken(claim.scope, claim.token);
        room = grant.roomName;
        roomLeft = false;
        return input.connect({
          url: grant.url,
          token: grant.token,
          trackName: input.nextId(),
          sampleRate: SAMPLE_RATE,
          channels: 1,
          queueMs: QUEUE_MS,
        });
      },
    });
    /**
     * The monotonic instant the claim's segment is due, read once per speech
     * off the audio path: the database clock's reading bracketed by the
     * request, taking the earliest instant it could mean.
     */
    const deadline = async () => {
      const { segmentDueAt } = await input.store.verifyRoundBotPublication(
        claim.scope,
        claim.token,
      );
      const sentAtMs = input.monotonicNowMs();
      const serverNowMs = Date.parse(await input.store.databaseNow());
      // The server read happened somewhere after `sentAtMs`: assume the
      // earliest, so the local stop is never later than the database's.
      return Date.parse(segmentDueAt) - serverNowMs + sentAtMs;
    };
    const publish = async (
      job: BotSpeechJob,
      signal: AbortSignal,
      stopAtMs: number,
    ): Promise<PhraseOutcome> => {
      if (
        !(job.pcm instanceof Int16Array) ||
        job.sampleRate !== SAMPLE_RATE ||
        job.channels !== 1 ||
        job.pcm.length === 0 ||
        job.pcm.length > SAMPLE_RATE * 60 ||
        !Number.isFinite(stopAtMs)
      )
        throw createAppError('VALIDATION');
      if (signal.aborted) throw createAppError('CONFLICT');
      const frames = wholeFrames(job.pcm);
      const durationMs = (frames.length / SAMPLE_RATE) * 1000;
      const native = await publication.use();
      if (signal.aborted) throw createAppError('CONFLICT');
      // A whole phrase that cannot finish before the cutoff is never started.
      if (
        input.monotonicNowMs() + Math.max(0, native.queuedMs()) + durationMs >
        stopAtMs
      )
        return { complete: false, segmentEnded: true };
      // A publisher is always opened first, so this only refuses a broken order.
      if (room === undefined) throw createAppError('CONFLICT');
      const refused = new AbortController();
      let refusal: unknown;
      const refuse = (error: unknown) => {
        if (refused.signal.aborted) return;
        refusal = error;
        // The next attempt joins the session's fresh room (ADR 0110).
        roomLeft = isAppError(error) && error.reason === 'bot-room-changed';
        refused.abort();
      };
      // The phrase's authority and utterance, beside the audio: never awaited by it.
      const begun = input.store
        .beginRoundBotPhrase(
          job.scope,
          job.token,
          { phraseId: job.phraseId, text: job.text, durationMs },
          room,
        )
        .then(
          () => true,
          (error: unknown) => {
            refuse(error);
            return false;
          },
        );
      // The floor, re-read while the phrase plays: a refusal stops the audio.
      const played = new AbortController();
      const watching = (async () => {
        while (!played.signal.aborted && !refused.signal.aborted) {
          await input.waitUntilMs(
            input.monotonicNowMs() + FLOOR_WATCH_MS,
            played.signal,
          );
          if (played.signal.aborted) return;
          await input.store
            .verifyRoundBotPublication(job.scope, job.token)
            .catch(refuse);
        }
      })();
      const write = createStreamingAudioWriter({
        target: native,
        sampleRate: SAMPLE_RATE,
        channels: 1,
        nowMs: input.monotonicNowMs,
        waitUntilMs: input.waitUntilMs,
        leadMs: LEAD_MS,
      });
      const result = await write(
        frames,
        AbortSignal.any([signal, refused.signal]),
        stopAtMs,
      );
      // Never awaited: a read still in flight must not delay the next phrase.
      played.abort();
      void watching;
      // A phrase whose start was refused wrote no line: nothing to close.
      if (!(await begun)) throw refusal;
      const whole =
        !result.aborted && !result.cut && result.failure === undefined;
      await input.store.endRoundBotPhrase(
        job.scope,
        job.token,
        job.phraseId,
        whole
          ? { kind: 'whole' }
          : {
              kind: 'cut',
              // The padded tail is silence: count only the phrase's own samples.
              spoken: spokenPrefix(
                job.text,
                Math.min(1, result.playedSamples / job.pcm.length),
              ),
            },
      );
      if (refusal !== undefined) throw refusal;
      if (result.failure !== undefined) throw result.failure;
      return { complete: whole, segmentEnded: result.cut };
    };
    return {
      /** Joins the Room ahead of speech. */
      start: publication.start,
      deadline,
      publish,
      /** Ends the claim's publication; every later publish is refused. */
      close: publication.close,
    };
  };
}
