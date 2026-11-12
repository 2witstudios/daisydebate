import type { BotPublicationScope } from '@daisy/db/bot-publication';
import { isCapacityRefusal } from '@daisy/db/capacity';
import { isFinalBotSpeechRefusal } from '@daisy/db/bot-publication';
import { createAppError, isAppError } from '@daisy/errors';
import type { OneShotTimer } from '../../lib/worker-timers';
import {
  initialSpeakerState,
  nextSpeakerState,
  type DutyEffect,
  type DutyEvent,
  type Owed,
} from './duty';
import type { PhraseSource } from './phrase-source';
import { createSelfWake } from './self-wake';
import { unlessAborted } from './abortable';
import type { BotSpeechJob, PhraseOutcome } from './publication';

/** A provider answer held in memory until its usage and authority settle. */
type Answer<T> = {
  readonly value: T;
  /** Idempotent: safe to call again after a refusal. */
  readonly settle: () => Promise<void>;
};
/** One language answer: its phrases as they are produced, and its usage. */
type Generated = Answer<{ readonly phrases: PhraseSource }> & {
  /**
   * Records the answer's usage once it has ended. Idempotent: safe to call
   * again after a refusal, and it never asks the provider again.
   */
  readonly close: () => Promise<void>;
};
/**
 * How many phrases are voiced ahead of the one playing. One is not enough:
 * a long phrase can take longer to voice than a short one before it plays.
 */
const VOICED_AHEAD = 2;
/**
 * An opening shorter than this waits for the phrases after it to be voiced
 * before it plays: voicing a long phrase can outlast short ones, and a speech
 * that stalls after its first words sounds broken. A late start does not.
 */
const SHORT_OPENING_MS = 4000;
/** A later phrase, voiced while the current one plays (ADR 0122). */
type Upcoming = {
  readonly index: number;
  /** Settles once the answer is bought and its usage recorded. */
  done: Promise<void>;
  answer: Answer<BotSpeechJob> | null;
  settled: boolean;
  /** It bought nothing (a refused pool slot, a provider error): voice it again. */
  failed: boolean;
  /** The line id it will be spoken under; a new one once that line closed. */
  lineId: string;
};
/** How far one turn got; kept across deferrals so no step is bought twice. */
type Progress = {
  generated: Generated | null;
  settled: boolean;
  /** The answer stopped short and that was reported, once. */
  cutReported: boolean;
  /** The phrase not yet produced whose arrival resumes the voicing ahead. */
  awaiting: number | null;
  spoken: number;
  /** The phrase being spoken, and whether its usage and authority settled. */
  synthesized: Answer<BotSpeechJob> | null;
  ready: boolean;
  /** The phrases voiced ahead, each bought once and kept across retries. */
  ahead: Upcoming[];
  /** Ends the voicing ahead once the speech is over: nothing more is bought. */
  voicing: AbortController;
  /**
   * The spoken phrase's line id. A retry keeps it, so a phrase start that
   * committed but whose answer was lost is not written twice; it changes
   * only once the line was closed, so a cut phrase said again is a new line.
   */
  lineId: string | null;
  /** The last phrase reported played whole, under its line id. */
  said: {
    readonly answer: Answer<BotSpeechJob>;
    readonly lineId: string;
  } | null;
};
const freshProgress = (): Progress => ({
  generated: null,
  settled: false,
  cutReported: false,
  awaiting: null,
  spoken: 0,
  synthesized: null,
  ready: false,
  ahead: [],
  voicing: new AbortController(),
  lineId: null,
  said: null,
});
const STOPPED = 'Bot publication stopped before the phrase was sent';
const isPlatformIncidentRefusal = (error: unknown) =>
  isAppError(error) && error.reason === 'platform-incident';
/** What the seat's hearing reports about one peer. */
export type PeerActivity =
  | {
      readonly kind: 'speech-start' | 'barge-in' | 'unknown';
      readonly peer: string;
    }
  | {
      readonly kind: 'end-of-turn';
      readonly peer: string;
      /** The server instant that peer last spoke. */
      readonly spokeUntilMs: number;
    };
/**
 * One speaking turn at a time per owned claim. What the seat owes is one
 * value moved by pure transitions (`duty.ts`); this runs their effects.
 *
 * An answer is a phrase source: its phrases are voiced and played as they are
 * produced, so a speech starts with its first sentence, not its last. Each
 * phrase is authored into the transcript as it plays (ADR 0122), and the next
 * phrases are voiced while the current one plays, so there is no gap between
 * them. A speech buys one provider answer and keeps it through every failure
 * until it is delivered, so a retry resumes at the failed phrase and no answer
 * is bought twice; a phrase cut by a failure is said again whole, as a new
 * line. An answer that stops short is spoken to its last whole phrase and
 * ends there. Refused authority and refused pool admission wait without
 * spending an attempt, and the speaker wakes itself again shortly; a final
 * refusal ends the speech. The speaker never issues floor commands or touches
 * control receipts.
 */
export function createBotSpeaker(input: {
  readonly claim: {
    readonly scope: BotPublicationScope;
    readonly token: string;
    readonly segmentType: 'speech' | 'cross_ex';
    /** The scheduled seat asks first; every other cross-examination seat waits. */
    readonly opensExchange: boolean;
  };
  /** Opens the answer to `to`; resolves once its first phrase exists, or it ended. */
  readonly generate: (
    scope: BotPublicationScope,
    token: string,
    signal: AbortSignal,
    to: Owed,
  ) => Promise<Generated>;
  /**
   * Resolves once that peer's own words up to `spokeUntilMs` are in the
   * transcript, or it has waited long enough; it never rejects.
   */
  readonly heard: (
    peer: string,
    spokeUntilMs: number,
    signal: AbortSignal,
  ) => Promise<void>;
  /** Wakes the speaker again after a refusal, and after an unanswered question. */
  readonly timer: OneShotTimer;
  readonly synthesize: (
    scope: BotPublicationScope,
    token: string,
    phraseId: string,
    text: string,
    signal: AbortSignal,
  ) => Promise<Answer<BotSpeechJob>>;
  /** The monotonic instant the claim's segment is due, read once per speech. */
  readonly deadline: () => Promise<number>;
  /** Whether the publisher closed this line, so a retry needs a new one. */
  readonly lineClosed: (phraseId: string) => boolean;
  /**
   * Whether this line, reported played whole, had its queued tail cut since by
   * a later clear (the next phrase's stop, refusal or failure).
   */
  readonly tailCut: (phraseId: string) => boolean;
  /** Whether audio already handed over is still playing out of the queue. */
  readonly audible: () => boolean;
  /** Drops whatever is still queued, at once. */
  readonly silence: () => void;
  /** Authorizes a phrase while the one before it plays (ADR 0122). */
  readonly writeAhead: (job: BotSpeechJob) => void;
  /** Forgets phrases authorized ahead that will not be said. */
  readonly discard: () => void;
  /** Plays one phrase and authors its line; never plays past `stopAtMs`. */
  readonly publish: (
    job: BotSpeechJob,
    signal: AbortSignal,
    stopAtMs: number,
  ) => Promise<PhraseOutcome>;
  readonly nextId: () => string;
  readonly maxAttempts: number;
  /**
   * Whether a refusal is the provider budget being full: backpressure that
   * clears by itself, so what was bought is kept, in cross-examination too.
   */
  readonly busy: (error: unknown) => boolean;
  /** `stage` names the work that failed: generate, synthesize or publish. */
  readonly failed: (error: unknown, stage: string) => void;
}) {
  const { scope, token, segmentType, opensExchange } = input.claim;
  const crossEx = segmentType === 'cross_ex';
  const rules = {
    crossEx,
    asks: opensExchange,
    maxAttempts: input.maxAttempts,
  };
  let state = initialSpeakerState(rules);
  let running: { abort: AbortController; done: Promise<void> } | null = null,
    playing = false,
    stopped = false;
  /** Turns held back while a peer is mid-turn. */
  let held: (() => void)[] = [];
  let stage = 'generate';
  let progress = freshProgress();
  /** Plays one phrase under its line id, a new one once its line closed. */
  const speak = async (
    phrase: BotSpeechJob,
    signal: AbortSignal,
    stopAtMs: number,
  ) => {
    if (progress.lineId === null || input.lineClosed(progress.lineId))
      progress.lineId = input.nextId();
    playing = true;
    try {
      return await input.publish(
        { ...phrase, phraseId: progress.lineId },
        signal,
        stopAtMs,
      );
    } finally {
      playing = false;
    }
  };
  /** Voices phrase `index` ahead of its turn, holding the answer once bought. */
  const prefetch = (
    phrases: PhraseSource,
    text: string,
    index: number,
    signal: AbortSignal,
  ): Upcoming => {
    const upcoming: Upcoming = {
      index,
      answer: null,
      settled: false,
      failed: false,
      lineId: input.nextId(),
      done: Promise.resolve(),
    };
    const voicing = progress.voicing.signal;
    upcoming.done = (async () => {
      try {
        upcoming.answer = await input.synthesize(
          scope,
          token,
          input.nextId(),
          text,
          AbortSignal.any([signal, voicing]),
        );
      } catch (error) {
        upcoming.failed = true;
        throw error;
      }
      // A voice was bought, so a pool slot is free: one refused is asked again.
      if (!signal.aborted && !voicing.aborted) voiceAhead(phrases, signal);
      await upcoming.answer.settle();
      upcoming.settled = true;
      // Voiced while the phrase before it plays: its line is written now.
      if (
        progress.ahead.includes(upcoming) &&
        upcoming.index === progress.spoken + 1
      )
        prepareAhead(upcoming);
    })();
    // Read when its turn comes; one that bought nothing is voiced again.
    upcoming.done.catch(() => undefined);
    return upcoming;
  };
  /** Authorizes a voiced-ahead phrase while the phrase before it plays. */
  const prepareAhead = (upcoming: Upcoming) => {
    if (!playing || !upcoming.answer || !upcoming.settled) return;
    // A line closed is never written again under its id.
    if (input.lineClosed(upcoming.lineId)) upcoming.lineId = input.nextId();
    input.writeAhead({ ...upcoming.answer.value, phraseId: upcoming.lineId });
  };
  /**
   * Waits, for a short opening, until the phrases voiced so far would play for
   * SHORT_OPENING_MS, or every phrase voiced ahead is in: two short opening
   * phrases must not stall on a long third.
   */
  const holdShortOpening = async (signal: AbortSignal) => {
    const job = progress.synthesized?.value;
    if (!job) return;
    const lengthOf = (voiced: BotSpeechJob) =>
      (voiced.pcm.length / voiced.sampleRate) * 1000;
    let heldMs = lengthOf(job);
    const stopped = Promise.withResolvers<void>();
    const stop = () => stopped.resolve();
    signal.addEventListener('abort', stop, { once: true });
    try {
      for (
        let index = 1;
        heldMs < SHORT_OPENING_MS && index <= VOICED_AHEAD;
        index += 1
      ) {
        const next = progress.ahead.find((held) => held.index === index);
        if (!next || signal.aborted) return;
        await Promise.race([next.done.catch(() => undefined), stopped.promise]);
        // A voice refused or failed ends the hold: the speech goes on.
        const voiced = next.answer?.value;
        if (signal.aborted || !voiced) return;
        heldMs += lengthOf(voiced);
      }
    } finally {
      signal.removeEventListener('abort', stop);
    }
  };
  /**
   * Keeps the phrases after the one now due voiced ahead, each once, as far
   * as the answer has been produced; the next one resumes it as it arrives.
   */
  const voiceAhead = (phrases: PhraseSource, signal: AbortSignal) => {
    // A voice-ahead that bought nothing is asked again now, a phrase early,
    // never left to be bought only when its own turn comes.
    progress.ahead = progress.ahead.filter((held) => !held.failed);
    const last = progress.spoken + VOICED_AHEAD;
    for (let index = progress.spoken + 1; index <= last; index += 1) {
      if (progress.ahead.some((held) => held.index === index)) continue;
      const text = phrases.ready(index);
      if (text === undefined) return voiceWhenProduced(phrases, index, signal);
      progress.ahead.push(prefetch(phrases, text, index, signal));
    }
  };
  /** Resumes the voicing ahead once phrase `index` exists, asked once. */
  const voiceWhenProduced = (
    phrases: PhraseSource,
    index: number,
    signal: AbortSignal,
  ) => {
    if (phrases.ended() || progress.awaiting === index) return;
    const current = progress;
    current.awaiting = index;
    void phrases.at(index).then((text) => {
      if (progress !== current || current.awaiting !== index) return;
      current.awaiting = null;
      if (text !== null && !signal.aborted && !current.voicing.signal.aborted)
        voiceAhead(phrases, signal);
    });
  };
  /** The phrase now due: the voiced-ahead one, or bought now. */
  const take = async (
    phrases: PhraseSource,
    text: string,
    signal: AbortSignal,
  ) => {
    const upcoming = progress.ahead.find(
      (held) => held.index === progress.spoken,
    );
    if (upcoming) {
      progress.ahead = progress.ahead.filter((held) => held !== upcoming);
      // Later phrases keep being voiced while this one is readied.
      voiceAhead(phrases, signal);
      await upcoming.done.catch(() => undefined);
      // An answer bought but not settled is kept and settled again; one never
      // bought is voiced now, in turn, rather than deferring the whole turn.
      if (upcoming.answer) {
        progress.lineId ??= upcoming.lineId;
        return { answer: upcoming.answer, ready: upcoming.settled };
      }
    }
    const buying = input.synthesize(scope, token, input.nextId(), text, signal);
    // Later phrases are voiced alongside this one, so even a short phrase
    // never leaves the next waiting for its voice.
    voiceAhead(phrases, signal);
    const answer = await buying;
    // A voice was bought, so a pool slot is free: one refused is asked again.
    voiceAhead(phrases, signal);
    return { answer, ready: false };
  };
  const unlessStopped = <T>(work: Promise<T>, signal: AbortSignal) =>
    unlessAborted(work, signal, STOPPED);
  /**
   * No phrase starts over a peer who is mid-turn: the turn keeps what it
   * prepared and waits. That peer's turn ending owes a newer answer, which
   * replaces this one.
   */
  const floorClear = async (signal: AbortSignal) => {
    while (state.midTurn.length > 0)
      await unlessStopped(
        new Promise<void>((resolve) => held.push(resolve)),
        signal,
      );
    // The turn that ended may be the one that replaced this answer.
    if (signal.aborted) throw createAppError('CONFLICT', STOPPED);
  };
  /** Resumes the turn at its first unfinished step. */
  const deliver = async (signal: AbortSignal, to: Owed) => {
    stage = 'generate';
    if (!progress.generated) {
      // The peer's words reach the transcript after their turn ends: the
      // answer is made from them, never from the line before.
      if (to.kind === 'peer-turn')
        await unlessStopped(
          input.heard(to.peer, to.spokeUntilMs, signal),
          signal,
        );
      progress.generated = await input.generate(scope, token, signal, to);
    }
    if (!progress.settled) {
      await progress.generated.settle();
      progress.settled = true;
    }
    const { phrases } = progress.generated.value;
    stage = 'publish';
    // Once per speech, off the audio path: no phrase plays past the cutoff.
    const stopAtMs = await input.deadline();
    for (;;) {
      const text =
        phrases.ready(progress.spoken) ??
        (await unlessStopped(phrases.at(progress.spoken), signal));
      if (text === null) break;
      stage = 'synthesize';
      if (!progress.synthesized) {
        const next = await take(phrases, text, signal);
        progress.synthesized = next.answer;
        progress.ready = next.ready;
      }
      if (!progress.ready) {
        await progress.synthesized.settle();
        progress.ready = true;
      }
      if (progress.spoken === 0) await holdShortOpening(signal);
      // Before every phrase, not only the first: a peer may start in the gap
      // between two.
      if (crossEx) await floorClear(signal);
      stage = 'publish';
      const speaking = speak(progress.synthesized.value, signal, stopAtMs);
      // The next phrase, if already voiced, has its line written as this plays.
      const next = progress.ahead.find(
        (held) => held.index === progress.spoken + 1,
      );
      if (next) prepareAhead(next);
      const outcome = await speaking.catch((error: unknown) => {
        stepBackIfTailCut();
        throw error;
      });
      // The segment is over: the speech ends at its last whole phrase, once
      // what it did play (cut at the hard stop) has its line.
      if (outcome.segmentEnded) return dropAhead();
      if (!outcome.complete) throw createAppError('CONFLICT', STOPPED);
      progress.spoken += 1;
      progress.said = {
        answer: progress.synthesized,
        lineId: progress.lineId ?? '',
      };
      progress.synthesized = null;
      progress.ready = false;
      progress.lineId = null;
      selfWake.progressed();
    }
    dropAhead();
    // An answer that stopped short was spoken to its last whole phrase; it
    // ends there, and nothing is bought in its place.
    const cut = phrases.cutBy();
    if (cut && !progress.cutReported) {
      progress.cutReported = true;
      input.failed(cut.error, 'generate');
    }
    stage = 'generate';
    await progress.generated.close();
  };
  /**
   * A phrase that failed may have cut the queued tail of the one before it,
   * reported played whole: that one closed cut, so the turn steps back to it
   * and says it again whole, as a new line (ADR 0122 §6), keeping the failed
   * phrase's voice for after it. A held Round's resume point counts a cut line
   * only to its start, on exactly this premise.
   */
  const stepBackIfTailCut = () => {
    const before = progress.said;
    const failed = progress.synthesized;
    if (!before || !failed || !input.tailCut(before.lineId)) return;
    progress.ahead.unshift({
      index: progress.spoken,
      answer: failed,
      settled: progress.ready,
      failed: false,
      lineId: progress.lineId ?? input.nextId(),
      done: Promise.resolve(),
    });
    progress.spoken -= 1;
    progress.synthesized = before.answer;
    progress.ready = true;
    progress.lineId = null;
    progress.said = null;
  };
  /**
   * The speech is over, or this answer is: voicing ahead stops, nothing more
   * is bought, and phrases authorized ahead are forgotten.
   */
  const dropAhead = () => {
    progress.voicing.abort();
    progress.ahead = [];
    input.discard();
  };
  /** A fresh start, with nothing left voicing ahead of the last one. */
  const resetProgress = () => {
    dropAhead();
    progress = freshProgress();
  };
  const cancel = () => running?.abort.abort();
  const effect = (kind: DutyEffect) => {
    switch (kind) {
      case 'start':
        return start();
      case 'cut': {
        // A phrase being written stops itself, counting only what played; a
        // tail left after its publish returned is silenced here.
        const writing = playing;
        cancel();
        if (!writing) input.silence();
        return;
      }
      case 'restart':
        return cancel();
      case 'drop':
        // A running turn drops its own goods as it ends; they are still in use.
        return running ? undefined : resetProgress();
      case 'silence':
        return input.silence();
      case 'retry-soon':
        return stopped ? undefined : selfWake.retrySoon();
      case 'await-reply':
        return selfWake.awaitReply();
    }
  };
  const apply = (event: DutyEvent) => {
    const next = nextSpeakerState(state, event, rules);
    state = next.state;
    if (state.duty.status !== 'waiting' || !state.duty.unanswered)
      selfWake.stopAwaitingReply();
    if (state.midTurn.length === 0) {
      const waiting = held;
      held = [];
      for (const release of waiting) release();
    }
    for (const kind of next.effects) effect(kind);
  };
  /** How one failed turn moves the duty; a refusal that can clear spends nothing. */
  const recover = (error: unknown) => {
    // A spent voice budget or an answered segment cannot clear: stop.
    if (isFinalBotSpeechRefusal(error))
      return apply({ type: 'refused-for-good' });
    // Pool backpressure is a deferral: the next wake resumes at the refused step.
    if (isCapacityRefusal(error)) {
      input.failed(error, stage);
      return apply({ type: 'deferred', authorityChanged: false });
    }
    // A platform incident and a full provider budget are waits: the same
    // answer resumes where it stopped, in cross-examination too, with nothing
    // new bought and no attempt spent.
    if (isPlatformIncidentRefusal(error) || input.busy(error))
      return apply({ type: 'deferred', authorityChanged: false });
    // One paid answer per speech: every other failure keeps it, and the
    // next attempt resumes at the failed step. A cross-examination answer
    // belongs to its peer turn, so changed authority drops it.
    if (isAppError(error) && error.code === 'CONFLICT')
      return apply({ type: 'deferred', authorityChanged: true });
    // An answer with nothing to say is unusable: the next attempt buys another.
    const unusable =
      progress.generated !== null &&
      progress.generated.value.phrases.ended() &&
      progress.generated.value.phrases.ready(0) === undefined;
    input.failed(error, stage);
    apply({ type: 'failed', unusable });
  };
  const turn = async (abort: AbortController, to: Owed) => {
    let failure: { readonly error: unknown } | null = null;
    try {
      await deliver(abort.signal, to);
    } catch (error) {
      failure = { error };
    }
    running = null;
    // A turn cut or replaced was already settled by what stopped it.
    if (abort.signal.aborted) return resetProgress();
    if (failure) recover(failure.error);
    else apply({ type: 'delivered' });
  };
  const start = () => {
    if (state.duty.status !== 'speaking') return;
    const abort = new AbortController();
    running = { abort, done: Promise.resolve() };
    running.done = turn(abort, state.duty.to);
  };
  const wake = () => {
    if (stopped || running || selfWake.pausing()) return;
    apply({ type: 'woke' });
  };
  const selfWake = createSelfWake({
    timer: input.timer,
    resume: wake,
    unanswered: () => {
      apply({ type: 'silence-elapsed' });
      wake();
    },
  });
  return {
    wake,
    peer(activity: PeerActivity) {
      switch (activity.kind) {
        // No fresh audio says nothing about the peer: nothing changes.
        case 'unknown':
          return;
        case 'speech-start':
        case 'barge-in':
          return apply({
            type: 'peer-spoke',
            peer: activity.peer,
            audible: playing || input.audible(),
          });
        case 'end-of-turn':
          return apply({
            type: 'peer-turn-ended',
            peer: activity.peer,
            spokeUntilMs: activity.spokeUntilMs,
          });
      }
    },
    playing: () => playing || input.audible(),
    async stop() {
      stopped = true;
      const current = running;
      selfWake.stop();
      apply({ type: 'stopped' });
      await current?.done;
      dropAhead();
    },
  };
}
