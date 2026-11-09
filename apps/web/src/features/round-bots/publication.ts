import type { createAudioPublication } from '@daisy/media/audio';
import { createStreamingAudioWriter } from '@daisy/media/publication';
import type { Database } from '@daisy/db';
import type { BotPublicationScope } from '@daisy/db/bot-publication';
import { spokenPrefix } from '@daisy/protocol';
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
const LEAD_MS = 300;
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
  /**
   * Settles once the phrase's line is authored, or rejects with why it never
   * was: a phrase counts as spoken only once this settles (ADR 0122).
   */
  readonly line: Promise<void>;
};
/** Attempts at a phrase start that failed for no reason a retry cannot clear. */
const BEGIN_ATTEMPTS = 3;
const BEGIN_RETRY_MS = 100;
/** A refusal is an answer; anything else (a lost reply, a timeout) is worth asking again. */
const transientBegin = (error: unknown) =>
  !isAppError(error) ||
  !['CONFLICT', 'AUTHORIZATION', 'VALIDATION', 'NOT_FOUND'].includes(
    error.code,
  );
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
    /** The native track in use, so a close can silence it at once. */
    let current: Publication | null = null;
    /**
     * When the native queue was cleared (an abort, a failure, a silence or the
     * end), recent ones kept, so each phrase finds the clear that cut it.
     */
    let clears: number[] = [];
    const cleared = () => {
      clears = [...clears.slice(-31), input.monotonicNowMs()];
    };
    /** Each played phrase's line closes here, in order, beside the next one's audio. */
    let closing: Promise<void> = Promise.resolve();
    /**
     * Lines whose start was refused or never confirmed: said again, each
     * starts before any of its audio plays, so nothing is heard unwritten.
     */
    const doubtful = new Set<string>();
    /** Lines this claim closed; a retry of any other line reuses its id. */
    const closed = new Set<string>();
    const ended = new AbortController();
    let closing_down: Promise<void> | undefined;
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
     * Closes a line at what played, asked again on a failure: an end left
     * undone would later be estimated from time alone. The line counts as
     * closed from the first attempt, so a retry of its phrase is a new line
     * whether or not an end whose answer was lost committed.
     */
    const endLine = async (job: BotSpeechJob, playedFraction: number) => {
      closed.add(job.phraseId);
      const end =
        playedFraction >= 1
          ? ({ kind: 'whole' } as const)
          : ({
              kind: 'cut',
              spoken: spokenPrefix(job.text, playedFraction),
            } as const);
      for (let attempt = 1; ; attempt += 1) {
        try {
          await input.store.endRoundBotPhrase(
            job.scope,
            job.token,
            job.phraseId,
            end,
          );
          return;
        } catch (error) {
          if (!transientBegin(error) || attempt >= BEGIN_ATTEMPTS) throw error;
          await input.waitUntilMs(
            input.monotonicNowMs() + BEGIN_RETRY_MS * attempt,
            new AbortController().signal,
          );
        }
      }
    };
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
      // Whole 10 ms frames: an exact integer, as the line's length must be.
      const durationMs = frames.length / (SAMPLE_RATE / 1000);
      const native = await publication.use();
      current = native;
      if (signal.aborted) throw createAppError('CONFLICT');
      // A whole phrase that cannot finish before the cutoff is never started.
      if (
        input.monotonicNowMs() + Math.max(0, native.queuedMs()) + durationMs >
        stopAtMs
      )
        return {
          complete: false,
          segmentEnded: true,
          line: Promise.resolve(),
        };
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
      // The phrase's authority and utterance, beside the audio: never awaited
      // by it. An exact retry under the same id writes nothing twice.
      const joined = room;
      const line = (async () => {
        for (let attempt = 1; ; attempt += 1) {
          try {
            await input.store.beginRoundBotPhrase(
              job.scope,
              job.token,
              { phraseId: job.phraseId, text: job.text, durationMs },
              joined,
            );
            doubtful.delete(job.phraseId);
            return;
          } catch (error) {
            if (!transientBegin(error) || attempt >= BEGIN_ATTEMPTS) {
              doubtful.add(job.phraseId);
              throw error;
            }
            await input.waitUntilMs(
              input.monotonicNowMs() + BEGIN_RETRY_MS * attempt,
              new AbortController().signal,
            );
          }
        }
      })();
      // Read by the speaker; a rejection nobody waits for is not unhandled.
      line.catch(() => undefined);
      const begun = line.then(
        () => true,
        (error: unknown) => {
          refuse(error);
          return false;
        },
      );
      // A line whose start failed before starts before any audio this time.
      if (doubtful.has(job.phraseId) && !(await begun)) throw refusal;
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
      // The padded tail is silence: count only the phrase's own samples.
      const fractionOf = (samples: number) =>
        Math.min(1, samples / job.pcm.length);
      if (result.aborted) {
        cleared();
        // The speech is stopping: close the line now, at what played.
        if (await begun) await endLine(job, fractionOf(result.playedSamples));
        if (refusal !== undefined) throw refusal;
        if (result.failure !== undefined) throw result.failure;
        return { complete: false, segmentEnded: false, line };
      }
      // Its last frames are still queued: the line closes once they have
      // played, beside the next phrase's audio, never in front of it.
      const handedAtMs = input.monotonicNowMs();
      const playsUntilMs = handedAtMs + Math.max(0, native.queuedMs());
      const wholeFraction = result.cut ? fractionOf(result.playedSamples) : 1;
      closing = closing.then(async () => {
        // A start that was never written has no line to close: the speaker
        // learns why from `line` and says the phrase again.
        if (!(await begun)) return;
        await input.waitUntilMs(playsUntilMs, ended.signal);
        // The first clear before its tail played out cut it there (AMEND-1).
        const cutAtMs =
          clears.find((at) => at > handedAtMs && at < playsUntilMs) ?? null;
        // What it handed over, less the tail the clear dropped.
        const fraction =
          cutAtMs === null
            ? wholeFraction
            : fractionOf(
                result.sentSamples -
                  ((playsUntilMs - cutAtMs) * SAMPLE_RATE) / 1000,
              );
        // An end that fails leaves the line unfinished, never invented.
        await endLine(job, Math.max(0, fraction)).catch(() => undefined);
      });
      return { complete: !result.cut, segmentEnded: result.cut, line };
    };
    return {
      /** Joins the Room ahead of speech. */
      start: publication.start,
      deadline,
      publish,
      /** Whether this claim closed the line: a retry then needs a new one. */
      lineClosed: (phraseId: string) => closed.has(phraseId),
      /** Whether audio handed over is still playing out of the queue. */
      audible: () => (current?.queuedMs() ?? 0) > 0,
      /** Drops whatever is still queued: a barge-in on a tail is silent at once. */
      silence: () => {
        if ((current?.queuedMs() ?? 0) <= 0) return;
        cleared();
        current?.clearQueue();
      },
      /**
       * Ends the claim's publication: silences it at once, closes every
       * played line at what was heard, and refuses every later publish.
       */
      close: () =>
        (closing_down ??= (async () => {
          cleared();
          current?.clearQueue();
          ended.abort();
          await closing;
          await publication.close();
        })()),
    };
  };
}
