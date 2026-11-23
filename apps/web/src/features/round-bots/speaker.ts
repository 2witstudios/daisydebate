import type { BotPublicationScope } from '@daisy/db/bot-publication';
import { createAppError } from '@daisy/errors';
import type { Waits } from '@daisy/clock';
import { retryPauseMs, type DutyEvent, type Owed } from './duty';
import {
  initialSpeechState,
  nextSpeechState,
  nextSpeechWork,
  phraseAt,
  hasBought,
  hasVoice,
  isPublishing,
  needsLine,
  openingToHold,
  awaitsFloor,
  phraseVerdict,
  reportsCut,
  setbackOf,
  stopAt,
  tailWasCut,
  voicesToBuy,
  type SpeechEffect,
  type SpeechEvent,
} from './model/speech-state';
import type { PhraseSource } from './phrase-source';
import { createSelfWake } from './self-wake';
import { unlessAborted } from './abortable';
import type { BotPublisher, BotSpeechJob } from './publication';

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
  /**
   * The answer will not be said any further: an answer still being written
   * stops, freeing its provider slot. What it already cost still settles.
   */
  readonly abandon: () => void;
};
const STOPPED = 'Bot publication stopped before the phrase was sent';
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
      /** How long their speech in the turn lasted, first frame to last. */
      readonly spokeForMs: number;
    };
/**
 * One speaking turn at a time per owned claim. Duty and paid receipt progress live in one
 * pure speech state (`model/speech-state.ts`); this interprets its directives.
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
  readonly waits: Waits;
  readonly synthesize: (
    scope: BotPublicationScope,
    token: string,
    phraseId: string,
    text: string,
    signal: AbortSignal,
  ) => Promise<Answer<BotSpeechJob>>;
  /**
   * The claim's publisher (`publication.ts`): what the speaker asks of it,
   * and the two facts it reads back about the lines it closed.
   */
  readonly publication: Pick<
    BotPublisher,
    | 'deadline'
    | 'lineClosed'
    | 'tailCut'
    | 'audible'
    | 'silence'
    | 'writeAhead'
    | 'discard'
    | 'publish'
  >;
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
  let state = initialSpeechState(rules);
  // Paid answers and pending I/O are resources keyed by the pure receipt ledger.
  const freshGoods = () => ({
    generated: null as Generated | null,
    voices: new Map<number, Answer<BotSpeechJob>>(),
    buying: new Map<number, Promise<void>>(),
    voicing: new AbortController(),
  });
  let goods = freshGoods();
  // The running turn's abort and its end: resources, not progress.
  let running: { abort: AbortController; done: Promise<void> } | null = null;
  // Woken whenever the duty changes, so a wait for the floor reads the state again.
  let floorWaiters: (() => void)[] = [];
  const record = (event: SpeechEvent) => {
    const next = nextSpeechState(state, event);
    state = next.state;
    return next.effects;
  };
  const work = (stage: 'generate' | 'synthesize' | 'publish') =>
    record({ type: 'work', stage });
  const unlessStopped = <T>(pending: Promise<T>, signal: AbortSignal) =>
    unlessAborted(pending, signal, STOPPED);
  const voiceLength = (job: BotSpeechJob) =>
    (job.pcm.length / job.sampleRate) * 1000;
  const prepareAhead = (index: number) => {
    const answer = goods.voices.get(index);
    if (!isPublishing(state) || phraseAt(state, index)?.status !== 'settled')
      return;
    if (!answer) return;
    if (needsLine(state, index, input.publication.lineClosed))
      record({
        type: 'line',
        generation: state.generation,
        index,
        lineId: input.nextId(),
      });
    const lineId = phraseAt(state, index)?.lineId;
    if (lineId !== null && lineId !== undefined)
      input.publication.writeAhead({ ...answer.value, phraseId: lineId });
  };
  const buyVoice = (
    phrases: PhraseSource,
    text: string,
    index: number,
    signal: AbortSignal,
  ) => {
    const current = goods;
    const generation = state.generation;
    record({
      type: 'voice-requested',
      generation,
      index,
      lineId: input.nextId(),
    });
    const voicing = current.voicing.signal;
    const pending = (async () => {
      let answer: Answer<BotSpeechJob>;
      try {
        answer = await input.synthesize(
          scope,
          token,
          input.nextId(),
          text,
          AbortSignal.any([signal, voicing]),
        );
      } catch (error) {
        record({ type: 'voice-failed', generation, index });
        throw error;
      }
      current.voices.set(index, answer);
      record({
        type: 'voice-received',
        generation,
        index,
        durationMs: voiceLength(answer.value),
      });
      const live = () =>
        state.generation === generation && state.turn.voicing === 'open';
      if (live() && !signal.aborted) voiceAhead(phrases, signal);
      // A paid receipt settles even if its generation was replaced meanwhile.
      record({ type: 'voice-settling', generation, index });
      try {
        await answer.settle();
      } catch (error) {
        record({ type: 'voice-unsettled', generation, index });
        throw error;
      }
      record({ type: 'voice-settled', generation, index });
      if (state.generation === generation && index === state.turn.cursor + 1)
        prepareAhead(index);
    })();
    current.buying.set(index, pending);
    pending.catch(() => undefined);
    return pending;
  };
  const voiceWhenProduced = (
    phrases: PhraseSource,
    index: number,
    signal: AbortSignal,
  ) => {
    if (phrases.ended() || state.turn.awaiting === index) return;
    const generation = state.generation;
    record({ type: 'await-phrase', generation, index });
    void phrases.at(index).then((text) => {
      if (state.generation !== generation || state.turn.awaiting !== index)
        return;
      record({ type: 'await-phrase', generation, index: null });
      if (text !== null && !signal.aborted && state.turn.voicing === 'open')
        voiceAhead(phrases, signal);
    });
  };
  const voiceAhead = (phrases: PhraseSource, signal: AbortSignal) => {
    for (const index of voicesToBuy(state)) {
      const text = phrases.ready(index);
      if (text === undefined) return voiceWhenProduced(phrases, index, signal);
      void buyVoice(phrases, text, index, signal);
    }
  };
  const take = async (
    phrases: PhraseSource,
    text: string,
    signal: AbortSignal,
  ) => {
    const index = state.turn.cursor;
    if (phraseAt(state, index)) {
      voiceAhead(phrases, signal);
      await goods.buying.get(index)?.catch(() => undefined);
    }
    if (!hasVoice(state, index)) {
      const buying = buyVoice(phrases, text, index, signal);
      voiceAhead(phrases, signal);
      await buying;
    }
  };
  /** Waits on what the state says the opening is held for, until it says go. */
  const holdOpening = async (signal: AbortSignal) => {
    record({ type: 'opening-begins' });
    const stopped = Promise.withResolvers<void>();
    const stop = () => stopped.resolve();
    const isAborted = () => signal.aborted;
    signal.addEventListener('abort', stop, { once: true });
    try {
      for (
        let index = openingToHold(state);
        index !== null && !signal.aborted;
        index = openingToHold(state)
      ) {
        const pending = goods.buying.get(index)?.catch(() => undefined);
        await Promise.race([pending, stopped.promise]);
        // Read live: the abort can land while the voice is awaited.
        const held = !isAborted() && hasVoice(state, index);
        record({ type: 'opening-held', index, held });
      }
    } finally {
      signal.removeEventListener('abort', stop);
    }
  };
  /** Waits while the state says a peer holds the floor. */
  const floorClear = async (signal: AbortSignal) => {
    while (awaitsFloor(state, rules))
      await unlessStopped(
        new Promise<void>((resolve) => floorWaiters.push(resolve)),
        signal,
      );
    if (signal.aborted) throw createAppError('CONFLICT', STOPPED);
  };
  const speak = async (signal: AbortSignal) => {
    const index = state.turn.cursor;
    const answer = hasVoice(state, index) ? goods.voices.get(index) : undefined;
    const stopAtMs = stopAt(state);
    if (!answer || stopAtMs === null) throw createAppError('CONFLICT', STOPPED);
    if (needsLine(state, index, input.publication.lineClosed))
      record({
        type: 'line',
        generation: state.generation,
        index,
        lineId: input.nextId(),
      });
    const lineId = phraseAt(state, index)?.lineId;
    if (lineId === null || lineId === undefined)
      throw createAppError('CONFLICT', STOPPED);
    record({ type: 'publishing', active: true });
    try {
      return await input.publication.publish(
        { ...answer.value, phraseId: lineId },
        signal,
        stopAtMs,
      );
    } finally {
      record({ type: 'publishing', active: false });
    }
  };
  const stepBackIfTailCut = () => {
    if (tailWasCut(state, input.publication.tailCut))
      record({ type: 'tail-cut', generation: state.generation });
  };
  const dropAhead = () => {
    goods.voicing.abort();
    record({ type: 'drop-ahead', generation: state.generation });
    input.publication.discard();
  };
  const resetProgress = () => {
    dropAhead();
    goods.generated?.abandon();
    goods = freshGoods();
    record({ type: 'reset' });
  };
  const deliver = async (signal: AbortSignal, to: Owed) => {
    const current = goods;
    const generation = state.generation;
    work('generate');
    if (nextSpeechWork(state, { text: '' }).type === 'generate') {
      if (to.kind === 'peer-turn')
        await unlessStopped(
          input.heard(to.peer, to.spokeUntilMs, signal),
          signal,
        );
      record({ type: 'language-requested', generation });
      current.generated = await input.generate(scope, token, signal, to);
      record({ type: 'language-received', generation });
    }
    if (!current.generated) throw createAppError('CONFLICT', STOPPED);
    if (nextSpeechWork(state, { text: '' }).type === 'settle-language') {
      await current.generated.settle();
      record({ type: 'language-settled', generation });
    }
    const { phrases } = current.generated.value;
    work('publish');
    record({ type: 'deadline', atMs: await input.publication.deadline() });
    for (;;) {
      const text =
        phrases.ready(state.turn.cursor) ??
        (await unlessStopped(phrases.at(state.turn.cursor), signal));
      const next = nextSpeechWork(state, { text });
      switch (next.type) {
        case 'generate':
        case 'settle-language':
          throw createAppError('CONFLICT', STOPPED);
        case 'finish': {
          dropAhead();
          const cut = phrases.cutBy();
          if (cut && reportsCut(state, true)) {
            record({ type: 'cut-reported', generation });
            input.failed(cut.error, 'generate');
          }
          work('generate');
          await current.generated.close();
          return;
        }
        case 'await-voice':
        case 'voice':
          work('synthesize');
          if (text === null) throw createAppError('CONFLICT', STOPPED);
          await take(phrases, text, signal);
          continue;
        case 'settle-voice': {
          work('synthesize');
          const index = state.turn.cursor;
          await current.voices.get(index)?.settle();
          record({ type: 'voice-settled', generation, index });
          continue;
        }
        case 'publish': {
          work('synthesize');
          voiceAhead(phrases, signal);
          if (state.turn.cursor === 0) await holdOpening(signal);
          await floorClear(signal);
          work('publish');
          const speaking = speak(signal);
          prepareAhead(state.turn.cursor + 1);
          const outcome = await speaking.catch((error: unknown) => {
            stepBackIfTailCut();
            throw error;
          });
          const verdict = phraseVerdict(outcome);
          if (verdict === 'segment-ended') return dropAhead();
          if (verdict === 'stopped') throw createAppError('CONFLICT', STOPPED);
          record({ type: 'phrase-sent', generation });
          // Paid voices the state no longer keeps are released.
          for (const index of current.voices.keys())
            if (!phraseAt(state, index)) {
              current.voices.delete(index);
              current.buying.delete(index);
            }
          apply({ type: 'phrase-said' });
        }
      }
    }
  };
  const cancel = () => running?.abort.abort();
  const effect = (kind: SpeechEffect) => {
    switch (kind) {
      case 'start':
        return start();
      case 'restart':
        return cancel();
      case 'drop':
        return resetProgress();
      case 'silence':
        return input.publication.silence();
      case 'retry-soon':
        return selfWake.pauseFor(retryPauseMs(state.duty));
      case 'await-reply':
        return selfWake.awaitReply();
      case 'stop-awaiting-reply':
        return selfWake.stopAwaitingReply();
      case 'stop-pause':
        return selfWake.stopPause();
      case 'floor-free': {
        const waiting = floorWaiters;
        floorWaiters = [];
        for (const release of waiting) release();
        return;
      }
    }
  };
  const apply = (event: DutyEvent) => {
    for (const kind of record({ type: 'duty', event, rules })) effect(kind);
  };
  const recover = (error: unknown, stage: string) => {
    const phrases = goods.generated?.value.phrases;
    const setback = setbackOf(error, {
      busy: input.busy(error),
      unusable:
        phrases !== undefined &&
        phrases.ended() &&
        phrases.ready(0) === undefined,
    });
    if (setback.reported) input.failed(error, stage);
    apply(setback.event);
  };
  const turn = async (abort: AbortController, to: Owed) => {
    let failure: { readonly error: unknown } | null = null;
    try {
      await deliver(abort.signal, to);
    } catch (error) {
      failure = { error };
    }
    const stage = state.run.status === 'idle' ? 'generate' : state.run.stage;
    running = null;
    record({ type: 'run-ended' });
    if (abort.signal.aborted) return resetProgress();
    if (failure) recover(failure.error, stage);
    else apply({ type: 'delivered' });
  };
  const start = () => {
    if (state.duty.status !== 'speaking') return;
    const abort = new AbortController();
    work('generate');
    running = { abort, done: Promise.resolve() };
    running.done = turn(abort, state.duty.to);
  };
  const wake = () => {
    if (state.duty.status === 'over' || state.run.status !== 'idle') return;
    apply({ type: 'woke' });
  };
  const selfWake = createSelfWake({
    waits: input.waits,
    resume: () => {
      apply({ type: 'pause-ended' });
      wake();
    },
    unanswered: () => {
      apply({ type: 'silence-elapsed' });
      wake();
    },
  });
  return {
    wake,
    peer(activity: PeerActivity) {
      switch (activity.kind) {
        case 'unknown':
          return;
        case 'speech-start':
        case 'barge-in':
          return apply({
            type: 'peer-spoke',
            peer: activity.peer,
            audible: isPublishing(state) || input.publication.audible(),
            bought: hasBought(state),
          });
        case 'end-of-turn':
          return apply({
            type: 'peer-turn-ended',
            peer: activity.peer,
            spokeUntilMs: activity.spokeUntilMs,
            spokeForMs: activity.spokeForMs,
          });
      }
    },
    playing: () => isPublishing(state) || input.publication.audible(),
    async stop() {
      const current = running;
      selfWake.stop();
      apply({ type: 'stopped' });
      await current?.done;
      dropAhead();
    },
  };
}
