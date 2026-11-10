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
const transient = (error: unknown) =>
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
    | 'verifyRoundBotPublication'
    | 'beginRoundBotPhrase'
    | 'endRoundBotPhrase'
    | 'revealRoundBotPhrase'
    | 'watchRoundBotFloor'
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
    /** The database clock less the monotonic one, read with the speech's deadline. */
    let dbOffsetMs: number | null = null;
    /** A phrase is between its publish and its first frame: its schedule is not known yet. */
    let starting = false;
    /** A phrase asked to be authorized ahead while the schedule was not known yet. */
    let waitingPrepare: BotSpeechJob | null = null;
    /**
     * Phrases authorized ahead of their audio, while the phrase before them
     * plays, so no phrase waits on its own start and none is heard unchecked.
     * Nothing is written for them until their audio starts (ADR 0122).
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
     * Asks again, backing off, while a call fails for a passing reason. A
     * start (`writes`) stops once the claim ended, so nothing new is written
     * after it; an end only closes or removes text, so it is
     * asked again whatever happens: left undone, it would be read as said.
     */
    const retryTransient = async (
      call: () => Promise<unknown>,
      writes: boolean,
    ) => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          await call();
          return;
        } catch (error) {
          if (!transient(error) || attempt >= BEGIN_ATTEMPTS) throw error;
          await input.waitUntilMs(
            input.monotonicNowMs() + BEGIN_RETRY_MS * attempt,
            writes ? ended.signal : new AbortController().signal,
          );
          if (writes && ended.signal.aborted) throw error;
        }
      }
    };
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
              playedMs: Math.round(playedFraction * durationOf(job)),
            } as const);
      await retryTransient(
        () =>
          input.store.endRoundBotPhrase(
            job.scope,
            job.token,
            job.phraseId,
            end,
          ),
        false,
      );
    };
    /** Whole 10 ms frames: an exact integer, as the line's length must be. */
    const durationOf = (job: BotSpeechJob) =>
      wholeFrames(job.pcm).length / (SAMPLE_RATE / 1000);
    /**
     * Authorizes a phrase, its audio starting `startsInMs` ahead; it writes
     * nothing. A start that failed for a reason a retry can clear is asked
     * again under the same id.
     */
    const begin = (job: BotSpeechJob, joined: string, startsInMs: number) => {
      // Dated on the database clock now, at the asking, so a start that
      // waits on a lock is still dated by its audio, never by its commit.
      const startsAt =
        dbOffsetMs === null
          ? undefined
          : new Date(
              input.monotonicNowMs() + startsInMs + dbOffsetMs,
            ).toISOString();
      const line = retryTransient(
        () =>
          input.store.beginRoundBotPhrase(
            job.scope,
            job.token,
            {
              phraseId: job.phraseId,
              text: job.text,
              durationMs: durationOf(job),
              startsInMs,
              ...(startsAt === undefined ? {} : { startsAt }),
            },
            joined,
          ),
        true,
      );
      // Read when its phrase plays; a rejection nobody waits for is not unhandled.
      line.catch(() => undefined);
      return line;
    };
    /**
     * Silences whatever is still queued at once, recording the clear so the
     * phrase it cut closes at what played, and, unless only a tail is being
     * silenced, forgets every phrase authorized ahead.
     */
    const clearNow = (forgetAhead: boolean) => {
      if ((current?.queuedMs() ?? 0) > 0) {
        cleared();
        current?.clearQueue();
      }
      if (forgetAhead) discard();
    };
    /** Ends that kept failing: asked again at the next phrase and at the end. */
    let unfinished: {
      readonly job: BotSpeechJob;
      readonly fraction: number;
    }[] = [];
    /** Closes a line, keeping it to ask again later if its end keeps failing. */
    const settleLine = async (job: BotSpeechJob, fraction: number) => {
      try {
        await endLine(job, fraction);
      } catch {
        unfinished.push({ job, fraction });
      }
    };
    const retryUnfinished = async () => {
      const pending = unfinished;
      unfinished = [];
      await Promise.all(
        pending.map(({ job, fraction }) => settleLine(job, fraction)),
      );
    };
    /**
     * Forgets phrases authorized ahead whose audio will not play. Nothing was
     * written for them: a line is written only as its phrase is said.
     */
    const discard = () => prepared.clear();
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
      prepared.set(job.phraseId, { job, line: begin(job, room, startsInMs) });
    };
    /**
     * The monotonic instant the claim's segment is due, read once per speech
     * off the audio path: the database clock's reading bracketed by the
     * request, taking the earliest instant it could mean.
     */
    const deadline = async () => {
      const sentAtMs = input.monotonicNowMs();
      const { segmentDueAt, now } = await input.store.verifyRoundBotPublication(
        claim.scope,
        claim.token,
      );
      const serverNowMs = Date.parse(now);
      // The server read happened somewhere after `sentAtMs`: assume the
      // earliest, so the local stop is never later than the database's, and
      // a line's start is dated no earlier than its audio.
      dbOffsetMs = serverNowMs - sentAtMs;
      return Date.parse(segmentDueAt) - dbOffsetMs;
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
      if (signal.aborted) {
        clearNow(true);
        throw createAppError('CONFLICT');
      }
      starting = true;
      try {
        return await play(job, signal, stopAtMs);
      } catch (error) {
        // Its own phrase was never authorized, or it stopped: nothing after it
        // may be authorized ahead of it, so lines stay in the order they are said.
        waitingPrepare = null;
        discard();
        throw error;
      } finally {
        starting = false;
        waitingPrepare = null;
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
      if (signal.aborted) {
        clearNow(true);
        throw createAppError('CONFLICT');
      }
      // A whole phrase that cannot finish before the cutoff is never started,
      // and a phrase authorized ahead after it is forgotten.
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
      // It is authorized before any of its audio: usually ahead, while the
      // phrase before played, so this does not wait.
      const ahead = prepared.get(job.phraseId);
      prepared.delete(job.phraseId);
      const line =
        ahead?.line ??
        begin(job, room, Math.round(Math.max(0, native.queuedMs())));
      void retryUnfinished();
      try {
        await line;
      } catch (error) {
        // The next attempt joins the session's fresh room (ADR 0110).
        roomLeft = isAppError(error) && error.reason === 'bot-room-changed';
        throw error;
      }
      if (signal.aborted) {
        // Stopped before its audio: the tail before it is silenced too.
        clearNow(true);
        throw createAppError('CONFLICT');
      }
      scheduledEndMs =
        input.monotonicNowMs() + Math.max(0, native.queuedMs()) + durationMs;
      // Its schedule is known: a line asked for ahead is written now.
      starting = false;
      const waiting = waitingPrepare;
      waitingPrepare = null;
      if (waiting) writeAhead(waiting);
      const played = new AbortController();
      /** The writer stopped and dropped its queue: audio not yet started never plays. */
      const silenced = new AbortController();
      const joined = room;
      /**
       * Its reveal was sent: one whose answer was lost may still have written
       * the line, so it is closed too (closing a line never written is a no-op).
       */
      let asked = false;
      const audioStartsAtMs =
        input.monotonicNowMs() + Math.max(0, native.queuedMs());
      // Its reveal, beside the audio, as the audio starts: the claim, room and
      // floor are checked again then, the line is dated then and its doorbell
      // rings, so it is read exactly from when it is said. A refusal stops it.
      const revealing = (async () => {
        // Never tied to the writer's return: a phrase shorter than the lead is
        // handed over before its audio starts, and is still revealed then.
        const stopped = AbortSignal.any([
          refused.signal,
          ended.signal,
          signal,
          silenced.signal,
        ]);
        await input.waitUntilMs(audioStartsAtMs, stopped);
        if (stopped.aborted) return;
        // Its audio start on the database clock, fixed now: a reveal that
        // waits on a lock still dates the line by its audio.
        const startedAt =
          dbOffsetMs === null
            ? undefined
            : new Date(audioStartsAtMs + dbOffsetMs).toISOString();
        asked = true;
        await retryTransient(
          () =>
            input.store.revealRoundBotPhrase(
              job.scope,
              job.token,
              { phraseId: job.phraseId, text: job.text, durationMs },
              joined,
              startedAt,
            ),
          true,
        );
      })().catch((error: unknown) => {
        // A phrase whose line cannot be written is not said: it stops, and
        // the speech says it again once its line can be written.
        refuse(error);
      });
      // The floor and room, re-read without a lock while the phrase plays: a
      // refusal stops the audio; a read failing for a passing reason is read
      // again next time.
      const watching = (async () => {
        while (!played.signal.aborted && !refused.signal.aborted) {
          await input.waitUntilMs(
            input.monotonicNowMs() + FLOOR_WATCH_MS,
            played.signal,
          );
          if (played.signal.aborted) return;
          await input.store
            .watchRoundBotFloor(job.scope, job.token, joined)
            .catch((error: unknown) => {
              if (!transient(error)) refuse(error);
            });
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
      void revealing;
      // The padded tail is silence: count only the phrase's own samples.
      const fractionOf = (samples: number) =>
        Math.min(1, samples / job.pcm.length);
      if (result.aborted) {
        // Any stop, a failed handoff included, dropped the queue: a reveal not
        // yet asked never writes a line for audio that will not play.
        silenced.abort();
        cleared();
        scheduledEndMs = input.monotonicNowMs();
        // The speech is stopping: phrases authorized ahead will not be said.
        discard();
        // Its line, if one may have been written, closes at what played; a reveal still
        // landing is waited for first, so it never writes a line after its end.
        await revealing;
        // An end that fails is asked again later; it never hides why this stopped.
        if (asked) await settleLine(job, fractionOf(result.playedSamples));
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
        await revealing;
        if (!asked) return;
        // The first clear before its tail played out cut it there (AMEND-1).
        const cutAtMs =
          clears.find((at) => at > handedAtMs && at < playsUntilMs) ?? null;
        const fraction = playedFraction({
          sentSamples: result.sentSamples,
          phraseSamples: job.pcm.length,
          playsUntilMs,
          cutAtMs,
        });
        // An end that keeps failing is asked again later, never left undone.
        await settleLine(job, fraction);
      });
      if (result.cut) discard();
      return { complete: !result.cut, segmentEnded: result.cut };
    };
    return {
      /** Joins the Room ahead of speech. */
      start: publication.start,
      deadline,
      writeAhead,
      /** Forgets every phrase authorized ahead: the speech will not say them. */
      discard,
      publish,
      /** Whether this claim closed the line: a retry then needs a new one. */
      lineClosed: (phraseId: string) => closed.has(phraseId),
      /** Whether audio handed over is still playing out of the queue. */
      audible: () => (current?.queuedMs() ?? 0) > 0,
      /** Drops whatever is still queued: a barge-in on a tail is silent at once. */
      silence: () => clearNow(false),
      /**
       * Ends the claim's publication: silences it at once, closes every
       * played line at what was heard, and refuses every later publish.
       */
      close: () =>
        (closing_down ??= (async () => {
          clearNow(true);
          ended.abort();
          await closing;
          await retryUnfinished();
          await publication.close();
        })()),
    };
  };
}
