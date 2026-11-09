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
/**
 * The share of a phrase that played (AMEND-1): what was handed over, less the
 * tail a clear dropped before it played out. The base is what was handed,
 * never the phrase's whole length, so a phrase stopped at the hard stop and
 * then cleared never counts the cleared part as heard.
 */
export function playedFraction(input: {
  readonly sentSamples: number;
  readonly phraseSamples: number;
  readonly playsUntilMs: number;
  readonly cutAtMs: number | null;
}): number {
  const dropped =
    input.cutAtMs === null
      ? 0
      : ((input.playsUntilMs - input.cutAtMs) * SAMPLE_RATE) / 1000;
  return Math.min(
    1,
    Math.max(0, input.sentSamples - dropped) / input.phraseSamples,
  );
}
/** How a published phrase ended: played whole, cut at the segment end, or stopped. */
export type PhraseOutcome = {
  readonly complete: boolean;
  /** It reached the speech's hard stop: the segment is over for this bot. */
  readonly segmentEnded: boolean;
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
     * When the audio handed over so far finishes playing: a line written
     * ahead is dated by it, so its start and fit match its playout.
     */
    let scheduledEndMs = -Infinity;
    /** A phrase is between its publish and its first frame: its schedule is not known yet. */
    let starting = false;
    /** A line asked to be written ahead while the schedule was not known yet. */
    let waitingPrepare: BotSpeechJob | null = null;
    /**
     * Lines written ahead of their audio, while the phrase before them plays,
     * so no phrase waits on its own start and none is heard unwritten.
     */
    const prepared = new Map<
      string,
      { readonly job: BotSpeechJob; readonly line: Promise<void> }
    >();
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
    /** Whole 10 ms frames: an exact integer, as the line's length must be. */
    const durationOf = (job: BotSpeechJob) =>
      wholeFrames(job.pcm).length / (SAMPLE_RATE / 1000);
    /**
     * Writes a phrase's line, dated `startsInMs` ahead. A start that failed
     * for no reason a retry cannot clear is asked again under the same id,
     * where an exact retry writes nothing twice.
     */
    const begin = (job: BotSpeechJob, joined: string, startsInMs: number) => {
      const line = (async () => {
        for (let attempt = 1; ; attempt += 1) {
          try {
            await input.store.beginRoundBotPhrase(
              job.scope,
              job.token,
              {
                phraseId: job.phraseId,
                text: job.text,
                durationMs: durationOf(job),
                startsInMs,
              },
              joined,
            );
            return;
          } catch (error) {
            if (!transientBegin(error) || attempt >= BEGIN_ATTEMPTS)
              throw error;
            await input.waitUntilMs(
              input.monotonicNowMs() + BEGIN_RETRY_MS * attempt,
              new AbortController().signal,
            );
          }
        }
      })();
      // Read when its phrase plays; a rejection nobody waits for is not unhandled.
      line.catch(() => undefined);
      return line;
    };
    /** Deletes lines written ahead whose audio will never play. */
    const discard = () => {
      for (const { job, line } of prepared.values())
        void line.then(
          () => endLine(job, 0).catch(() => undefined),
          () => undefined,
        );
      prepared.clear();
    };
    /**
     * Writes the next phrase's line while the current one plays, dated by
     * when its audio will start, so it is written before any of its audio
     * and the phrase never waits on it. Its publish uses this line.
     */
    const writeAhead = (job: BotSpeechJob) => {
      if (room === undefined || prepared.has(job.phraseId)) return;
      // Dated by the phrase now starting: written once its schedule is known.
      if (starting) {
        waitingPrepare = job;
        return;
      }
      const startsInMs = Math.max(
        0,
        Math.round(scheduledEndMs - input.monotonicNowMs()),
      );
      prepared.set(job.phraseId, {
        job,
        line: begin(job, room, Math.min(startsInMs, 60_000)),
      });
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
      starting = true;
      try {
        return await play(job, signal, stopAtMs);
      } finally {
        starting = false;
        const waiting = waitingPrepare;
        waitingPrepare = null;
        if (waiting) writeAhead(waiting);
      }
    };
    const play = async (
      job: BotSpeechJob,
      signal: AbortSignal,
      stopAtMs: number,
    ): Promise<PhraseOutcome> => {
      const frames = wholeFrames(job.pcm);
      const durationMs = durationOf(job);
      const native = await publication.use();
      current = native;
      if (signal.aborted) throw createAppError('CONFLICT');
      // A whole phrase that cannot finish before the cutoff is never started,
      // and a line written ahead for it, or any later one, is withdrawn.
      if (
        input.monotonicNowMs() + Math.max(0, native.queuedMs()) + durationMs >
        stopAtMs
      ) {
        discard();
        return { complete: false, segmentEnded: true };
      }
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
      // Its line is written before any of its audio: usually written ahead,
      // while the phrase before played, so this does not wait.
      const ahead = prepared.get(job.phraseId);
      prepared.delete(job.phraseId);
      const line =
        ahead?.line ??
        begin(job, room, Math.round(Math.max(0, native.queuedMs())));
      try {
        await line;
      } catch (error) {
        // The next attempt joins the session's fresh room (ADR 0110).
        roomLeft = isAppError(error) && error.reason === 'bot-room-changed';
        throw error;
      }
      if (signal.aborted) {
        await endLine(job, 0);
        throw createAppError('CONFLICT');
      }
      scheduledEndMs =
        input.monotonicNowMs() + Math.max(0, native.queuedMs()) + durationMs;
      // Its schedule is known: a line asked for ahead is written now.
      starting = false;
      const waiting = waitingPrepare;
      waitingPrepare = null;
      if (waiting) writeAhead(waiting);
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
        scheduledEndMs = input.monotonicNowMs();
        // The speech is stopping: close the line now, at what played, and
        // withdraw any line written ahead for audio that will never play.
        discard();
        await endLine(job, fractionOf(result.playedSamples));
        if (refusal !== undefined) throw refusal;
        if (result.failure !== undefined) throw result.failure;
        return { complete: false, segmentEnded: false };
      }
      // Its last frames are still queued: the line closes once they have
      // played, beside the next phrase's audio, never in front of it.
      const handedAtMs = input.monotonicNowMs();
      const playsUntilMs = handedAtMs + Math.max(0, native.queuedMs());
      closing = closing.then(async () => {
        await input.waitUntilMs(playsUntilMs, ended.signal);
        // The first clear before its tail played out cut it there (AMEND-1).
        const cutAtMs =
          clears.find((at) => at > handedAtMs && at < playsUntilMs) ?? null;
        const fraction = playedFraction({
          sentSamples: result.sentSamples,
          phraseSamples: job.pcm.length,
          playsUntilMs,
          cutAtMs,
        });
        // An end that fails leaves the line unfinished, never invented.
        await endLine(job, fraction).catch(() => undefined);
      });
      if (result.cut) discard();
      return { complete: !result.cut, segmentEnded: result.cut };
    };
    return {
      /** Joins the Room ahead of speech. */
      start: publication.start,
      deadline,
      writeAhead,
      /** Withdraws every line written ahead: the speech will not say them. */
      discard,
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
          discard();
          await closing;
          await publication.close();
        })()),
    };
  };
}
