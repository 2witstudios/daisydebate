import { createAppError, createRefusal, isAppError } from '@daisy/errors';
import { virtualClock } from '@daisy/clock/testing';
import { refuseCapacity } from '@daisy/db/testing';
import { refuseFinalSpeech } from '@daisy/db/bot-publication';
import { createPhraseSource } from './phrase-source';
import { createBotPublisher, type BotSpeechJob } from './publication';
import { createBotSpeaker } from './speaker';

/**
 * The bot corpus (R4.3 net first): a scripted round drives the real speaker
 * wired to the real publisher, as `speaking.ts` wires them, on a virtual
 * clock, over stubs for everything outside the bot: the store, the native
 * track, the language answer and the voice. Every call across that edge is
 * logged with its virtual instant, so a rewrite of the inside must log the
 * same thing.
 */

/** A failure a stub can answer with. */
export type Fault =
  | 'lost'
  | 'conflict'
  | 'room-changed'
  | 'incident'
  | 'final'
  | 'capacity'
  | 'busy';
/** One stubbed call's answer: after `delayMs` of virtual time, it succeeds or fails. */
export type Reply = { readonly delayMs?: number; readonly fail?: Fault };
type Phrase = { readonly text: string; readonly ms: number };
/** One language answer: its phrases, produced `gapMs` apart, then an end or a cut. */
export type Answer = {
  readonly phrases: readonly Phrase[];
  readonly delayMs?: number;
  readonly gapMs?: number;
  readonly fail?: Fault;
  readonly cut?: boolean;
  readonly settle?: readonly Reply[];
};
type Store = {
  readonly begin?: readonly Reply[];
  readonly reveal?: readonly Reply[];
  readonly end?: readonly Reply[];
  /** Floor reads while a phrase plays, after the claim's own reads. */
  readonly floor?: readonly Reply[];
  readonly verify?: readonly Reply[];
  readonly join?: readonly Reply[];
  /** Handoffs that fail, counted from 0 over the claim. */
  readonly failFrames?: readonly number[];
  /** The segment's due instant, in virtual ms. */
  readonly dueMs?: number;
};
export type SpeakerStep =
  | { readonly wake: true }
  | { readonly advance: number }
  | {
      readonly peer: 'speech-start' | 'barge-in' | 'end-of-turn';
      readonly who?: string;
    }
  | { readonly stop: true };
export type PublisherStep =
  | { readonly advance: number }
  | { readonly start: true }
  | { readonly deadline: true }
  | {
      readonly publish: string;
      readonly ms: number;
      /** Absolute virtual stop, or the read deadline when absent. */
      readonly stopAtMs?: number;
      /** Aborts the publish this long after it was asked. */
      readonly abortAfterMs?: number;
      /** Asked with its signal already aborted. */
      readonly preAborted?: boolean;
    }
  | { readonly writeAhead: string; readonly ms: number }
  | { readonly silence: true }
  | { readonly discard: true }
  | { readonly close: true }
  | { readonly query: true };
type Common = { readonly name: string; readonly store?: Store };
export type CorpusScript =
  | (Common & {
      readonly kind: 'speaker';
      readonly segment: 'speech' | 'cross_ex';
      readonly opensExchange?: boolean;
      readonly answers?: readonly Answer[];
      /** Per phrase text, each synthesis call's answer in turn. */
      readonly voices?: Readonly<Record<string, readonly Reply[]>>;
      /** Per phrase text, each voice settlement's answer in turn. */
      readonly voiceSettles?: Readonly<Record<string, readonly Reply[]>>;
      readonly steps: readonly SpeakerStep[];
    })
  | (Common & {
      readonly kind: 'publisher';
      readonly steps: readonly PublisherStep[];
    });

const DB_BASE_MS = 1_800_000_000_000;
const dbInstant = (ms: number) => new Date(DB_BASE_MS + ms).toISOString();
const busyRefusals = new WeakSet<Error>();
const faultOf = (fault: Fault): Error => {
  switch (fault) {
    case 'lost':
      return new Error('lost reply');
    case 'conflict':
      return createAppError('CONFLICT');
    case 'room-changed':
      return createRefusal('CONFLICT', 'bot-room-changed');
    case 'incident':
      return createRefusal('CONFLICT', 'platform-incident');
    case 'final':
      return refuseFinalSpeech('final');
    case 'capacity':
      return refuseCapacity();
    case 'busy': {
      const refusal = createAppError(
        'CONFLICT',
        'Provider capacity unavailable',
      );
      busyRefusals.add(refusal);
      return refusal;
    }
  }
};
const describeError = (error: unknown) =>
  isAppError(error)
    ? `${error.code}${error.reason ? `/${error.reason}` : ''}`
    : 'Error';
const pcmOf = (ms: number) => new Int16Array(24 * ms).fill(1);

/** What a walk's properties read: the edge's calls as data. */
export type Fact = { readonly at: number } & FactBody;
type FactBody =
  | {
      readonly kind: 'publish';
      readonly phraseId: string;
      readonly text: string;
      readonly stopAtMs: number;
      /** Its audio in whole 10 ms frames. */
      readonly durationMs: number;
    }
  | {
      readonly kind: 'frame';
      readonly phraseId: string | null;
      readonly playsUntilMs: number;
    }
  | { readonly kind: 'begin' | 'reveal'; readonly phraseId: string }
  | {
      readonly kind: 'end';
      readonly phraseId: string;
      readonly whole: boolean;
      readonly playedMs: number;
    }
  | { readonly kind: 'tts'; readonly text: string; readonly ok: boolean }
  | { readonly kind: 'generate'; readonly to: string; readonly ok: boolean }
  /** An answer said to its end: its usage is recorded. */
  | { readonly kind: 'delivered'; readonly to: string }
  | {
      readonly kind: 'peer';
      readonly peer: string;
      readonly event: 'speech-start' | 'barge-in' | 'end-of-turn';
    }
  | { readonly kind: 'close' | 'stop' | 'final' };
type Note = (body: FactBody) => void;

/** Runs one script and returns its log, one line per call across the edge. */
export async function recordCorpus(script: CorpusScript): Promise<string> {
  return (await traceCorpus(script)).log;
}

/** Runs one script: its log, and the same calls as facts. */
export async function traceCorpus(script: CorpusScript): Promise<{
  readonly log: string;
  readonly facts: readonly Fact[];
  /** Waits still armed once the claim ended and every timer ran out. */
  readonly sleepers: number;
}> {
  const clock = virtualClock();
  const lines: string[] = [];
  const facts: Fact[] = [];
  const note: Note = (body) => facts.push({ ...body, at: clock.nowMs() });
  let playing: string | null = null;
  let frames: {
    track: string;
    count: number;
    from: number;
    to: number;
  } | null = null;
  const flush = () => {
    if (!frames) return;
    lines.push(
      `${frames.from}..${frames.to} frames ${frames.track} x${frames.count}`,
    );
    frames = null;
  };
  const log = (line: string) => {
    flush();
    lines.push(`${clock.nowMs()} ${line}`);
  };
  const queues = new Map<string, readonly Reply[]>();
  const calls = new Map<string, number>();
  /** Takes the next scripted answer for `key`, waits it out, and fails if told to. */
  const reply = async (key: string, replies: readonly Reply[] | undefined) => {
    if (replies && !queues.has(key)) queues.set(key, replies);
    const call = calls.get(key) ?? 0;
    calls.set(key, call + 1);
    const answer = queues.get(key)?.[call] ?? {};
    if (answer.delayMs) await clock.sleep(answer.delayMs);
    if (answer.fail === 'final') note({ kind: 'final' });
    if (answer.fail) throw faultOf(answer.fail);
  };
  const store = script.store ?? {};
  const answered = async <T>(
    label: string,
    work: () => Promise<T>,
  ): Promise<T> => {
    try {
      const value = await work();
      return value;
    } catch (error) {
      log(`${label} -> ${describeError(error)}`);
      throw error;
    }
  };
  let ids = 0;
  let handoffs = 0;
  let playedUntil = 0;
  let joins = 0;
  const publisher = createBotPublisher({
    store: {
      verifyRoundBotPublication: () =>
        answered('verify', async () => {
          log('verify');
          await reply('verify', store.verify);
          return {
            segmentDueAt: dbInstant(store.dueMs ?? 60_000),
            now: dbInstant(clock.nowMs()),
          };
        }),
      watchRoundBotFloor: (_scope: unknown, _token: unknown, room: string) =>
        answered('floor', async () => {
          log(`floor ${room}`);
          await reply('floor', store.floor);
        }),
      beginRoundBotPhrase: (
        _scope: unknown,
        _token: unknown,
        phrase: {
          phraseId: string;
          durationMs: number;
          startsInMs: number;
          startsAt?: string;
        },
        room: string,
      ) =>
        answered('begin', async () => {
          note({ kind: 'begin', phraseId: phrase.phraseId });
          log(
            `begin ${phrase.phraseId} ${phrase.durationMs}ms in=${phrase.startsInMs} at=${phrase.startsAt ?? '-'} ${room}`,
          );
          await reply('begin', store.begin);
          return { duplicate: false };
        }),
      revealRoundBotPhrase: (
        _scope: unknown,
        _token: unknown,
        phrase: { phraseId: string },
        room: string,
        startedAt: string | undefined,
      ) =>
        answered('reveal', async () => {
          note({ kind: 'reveal', phraseId: phrase.phraseId });
          log(`reveal ${phrase.phraseId} ${room} at=${startedAt ?? '-'}`);
          await reply('reveal', store.reveal);
          return { revealed: true };
        }),
      endRoundBotPhrase: (
        _scope: unknown,
        _token: unknown,
        phraseId: string,
        end: { kind: string; spoken?: string; playedMs?: number },
      ) =>
        answered('end', async () => {
          log(
            `end ${phraseId} ${end.kind}${end.kind === 'cut' ? ` ${end.playedMs}ms "${end.spoken}"` : ''}`,
          );
          note({
            kind: 'end',
            phraseId,
            whole: end.kind === 'whole',
            playedMs: end.playedMs ?? 0,
          });
          await reply('end', store.end);
          return { changed: true };
        }),
    } as never,
    botToken: async () => {
      log('token');
      return { url: 'ws://media.test', token: 'grant', roomName: `room` };
    },
    connect: (async () => {
      const track = `TR_${joins++}`;
      log(`join ${track}`);
      await reply('join', store.join);
      let closed = false;
      return {
        trackSid: track,
        usable: () => !closed,
        sentSamples: () => handoffs * 240,
        capture10ms: async () => {
          const frame = handoffs;
          handoffs += 1;
          if (store.failFrames?.includes(frame)) {
            log(`frame ${track} #${frame} failed`);
            throw new Error('native source failed');
          }
          const now = clock.nowMs();
          if (frames?.track === track && frames.to + 10 >= now) {
            frames.count += 1;
            frames.to = now;
          } else {
            flush();
            frames = { track, count: 1, from: now, to: now };
          }
          playedUntil = Math.max(playedUntil, now) + 10;
          note({ kind: 'frame', phraseId: playing, playsUntilMs: playedUntil });
        },
        queuedMs: () => Math.max(0, playedUntil - clock.nowMs()),
        clearQueue: () => {
          log(
            `clear ${track} queued=${Math.max(0, playedUntil - clock.nowMs())}`,
          );
          playedUntil = clock.nowMs();
        },
        close: async () => {
          closed = true;
          log(`close ${track}`);
          return { consumedSamples: 0 };
        },
      };
    }) as never,
    nextId: () => `id${++ids}`,
    monotonicNowMs: clock.nowMs,
    waitUntilMs: clock.waitUntilMs,
  });
  const opened = publisher({ scope: scopeOf(), token: 't' });
  const claim: Claim = {
    ...opened,
    publish: (job, signal, stopAtMs) => {
      note({
        kind: 'publish',
        phraseId: job.phraseId,
        text: job.text,
        stopAtMs,
        durationMs: Math.ceil(job.pcm.length / 240) * 10,
      });
      playing = job.phraseId;
      return opened.publish(job, signal, stopAtMs);
    },
    close: () => {
      note({ kind: 'close' });
      return opened.close();
    },
  };
  if (script.kind === 'publisher')
    await runPublisher(script, claim, clock, log);
  else
    await runSpeaker(
      script,
      claim,
      clock,
      log,
      note,
      reply,
      () => `id${++ids}`,
    );
  flush();
  return {
    log: `${lines.join('\n')}\n`,
    facts,
    sleepers: clock.sleepers(),
  };
}

type Claim = ReturnType<ReturnType<typeof createBotPublisher>>;
type Clock = ReturnType<typeof virtualClock>;
type Log = (line: string) => void;
const scopeOf = () =>
  ({
    roundId: 'round',
    roundParticipantId: 'seat',
    segmentId: 'segment',
  }) as BotSpeechJob['scope'];
const jobOf = (phraseId: string, text: string, ms: number): BotSpeechJob => ({
  scope: scopeOf(),
  token: 't',
  phraseId,
  text,
  pcm: pcmOf(ms),
  sampleRate: 24000,
  channels: 1,
});
const WORDS = 'one two three four five six seven eight nine ten';
/** Long enough for every wait the bot can arm to come due. */
const DRAIN_MS = 30_000;

async function runPublisher(
  script: Extract<CorpusScript, { kind: 'publisher' }>,
  claim: Claim,
  clock: Clock,
  log: Log,
) {
  const seen = new Set<string>();
  const pending: Promise<unknown>[] = [];
  let deadline = Infinity;
  for (const step of script.steps) {
    if ('advance' in step) await clock.advance(step.advance);
    else if ('start' in step) claim.start();
    else if ('deadline' in step) {
      deadline = await clock.run(claim.deadline());
      log(`deadline ${deadline}`);
    } else if ('publish' in step) {
      seen.add(step.publish);
      const stop = new AbortController();
      const asked = clock.nowMs();
      if (step.preAborted) stop.abort();
      if (step.abortAfterMs !== undefined) {
        const at = asked + step.abortAfterMs;
        void clock.waitUntilMs(at).then(() => {
          log(`abort ${step.publish}`);
          stop.abort();
        });
      }
      const outcome = claim
        .publish(
          jobOf(step.publish, WORDS, step.ms),
          stop.signal,
          step.stopAtMs ?? deadline,
        )
        .then(
          (result) =>
            log(
              `published ${step.publish} complete=${result.complete} ended=${result.segmentEnded}`,
            ),
          (error: unknown) =>
            log(`published ${step.publish} -> ${describeError(error)}`),
        );
      pending.push(outcome);
      await clock.run(outcome);
    } else if ('writeAhead' in step) {
      seen.add(step.writeAhead);
      claim.writeAhead(jobOf(step.writeAhead, WORDS, step.ms));
    } else if ('silence' in step) claim.silence();
    else if ('discard' in step) claim.discard();
    else if ('close' in step) {
      await clock.run(claim.close());
      log('closed');
    } else
      log(
        `query audible=${claim.audible()} ${[...seen]
          .map(
            (id) =>
              `${id}:${claim.lineClosed(id) ? 'closed' : 'open'}${claim.tailCut(id) ? '/tail-cut' : ''}`,
          )
          .join(' ')}`,
      );
  }
  await clock.run(Promise.all(pending));
  await clock.run(claim.close());
  await clock.advance(DRAIN_MS);
}

async function runSpeaker(
  script: Extract<CorpusScript, { kind: 'speaker' }>,
  claim: Claim,
  clock: Clock,
  log: Log,
  note: Note,
  reply: (key: string, replies: readonly Reply[] | undefined) => Promise<void>,
  nextId: () => string,
) {
  let bought = 0;
  let spokeUntilMs = 0;
  const speaker = createBotSpeaker({
    claim: {
      scope: scopeOf(),
      token: 't',
      segmentType: script.segment,
      opensExchange: script.opensExchange ?? true,
    },
    generate: async (_scope, _token, signal, to) => {
      const answer = script.answers?.[bought] ?? script.answers?.at(-1);
      bought += 1;
      const turn =
        to.kind === 'peer-turn' ? `${to.peer}@${to.spokeUntilMs}` : to.kind;
      log(
        `generate ${to.kind}${to.kind === 'peer-turn' ? ` ${to.peer}@${to.spokeUntilMs}` : ''}`,
      );
      if (answer?.delayMs) await clock.sleep(answer.delayMs, signal);
      note({ kind: 'generate', to: turn, ok: !answer?.fail });
      if (answer?.fail) {
        log(`generate -> ${answer.fail}`);
        throw faultOf(answer.fail);
      }
      const producer = createPhraseSource();
      const call = bought;
      const phrases = answer?.phrases ?? [];
      void (async () => {
        for (const [index, phrase] of phrases.entries()) {
          if (index > 0 && answer?.gapMs) await clock.sleep(answer.gapMs);
          producer.push([phrase.text]);
        }
        if (answer?.cut) producer.cut(faultOf('lost'));
        else producer.end();
      })();
      await producer.source.at(0);
      return {
        value: { phrases: producer.source },
        settle: async () => {
          log(`settle answer ${call}`);
          await reply(`settle:${call}`, answer?.settle).catch((error) => {
            log(`settle answer ${call} -> ${describeError(error)}`);
            throw error;
          });
        },
        close: async () => {
          log(`close answer ${call}`);
          note({ kind: 'delivered', to: turn });
        },
        abandon: () => {
          log(`abandon answer ${call}`);
        },
      };
    },
    heard: async (peer, until) => {
      log(`heard ${peer}@${until}`);
    },
    waits: clock,
    synthesize: async (_scope, _token, phraseId, text, signal) => {
      log(`tts "${text}"`);
      const ms =
        script.answers
          ?.flatMap((answer) => answer.phrases)
          .find((phrase) => phrase.text === text)?.ms ?? 200;
      await reply(`tts:${text}`, script.voices?.[text]).catch((error) => {
        log(`tts "${text}" -> ${describeError(error)}`);
        note({ kind: 'tts', text, ok: false });
        throw error;
      });
      note({ kind: 'tts', text, ok: !signal.aborted });
      if (signal.aborted) throw createAppError('CONFLICT', 'aborted');
      return {
        value: jobOf(phraseId, text, ms),
        settle: async () => {
          log(`settle tts "${text}"`);
          await reply(`settle-tts:${text}`, script.voiceSettles?.[text]).catch(
            (error) => {
              log(`settle tts "${text}" -> ${describeError(error)}`);
              throw error;
            },
          );
        },
      };
    },
    deadline: claim.deadline,
    lineClosed: claim.lineClosed,
    tailCut: claim.tailCut,
    writeAhead: claim.writeAhead,
    discard: claim.discard,
    audible: claim.audible,
    silence: claim.silence,
    publish: claim.publish,
    nextId,
    maxAttempts: 2,
    busy: (error) => error instanceof Error && busyRefusals.has(error),
    failed: (error, stage) => {
      log(`failed ${stage} ${describeError(error)}`);
    },
  });
  for (const step of script.steps) {
    if ('wake' in step) speaker.wake();
    else if ('advance' in step) await clock.advance(step.advance);
    else if ('stop' in step) {
      note({ kind: 'stop' });
      await clock.run(speaker.stop());
      log('stopped');
    } else {
      const peer = step.who ?? 'peer';
      log(`peer ${step.peer} ${peer}`);
      note({ kind: 'peer', peer, event: step.peer });
      speaker.peer(
        step.peer === 'end-of-turn'
          ? {
              kind: step.peer,
              peer,
              spokeUntilMs: (spokeUntilMs += 1000),
              spokeForMs: 800,
            }
          : { kind: step.peer, peer },
      );
    }
    await clock.settle();
  }
  note({ kind: 'stop' });
  await clock.run(speaker.stop());
  await clock.run(claim.close());
  await clock.advance(DRAIN_MS);
}
