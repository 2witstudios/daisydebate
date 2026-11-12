import { createAppError } from '@daisy/errors';
import { phraseSourceOf, type PhraseSource } from './phrase-source';
import { createBotSpeaker, type PeerActivity } from './speaker';

export const scope = {
  roundId: 'round',
  roundParticipantId: 'seat',
  segmentId: 'segment',
  agentRunId: 'run',
  serviceId: 'agent-run:run',
  publicationEpoch: 1,
};
/** A provider answer whose settlement always succeeds. */
export const answered = <T>(value: T) => ({
  value,
  settle: async (): Promise<void> => undefined,
});
type SpeakerInput = Parameters<typeof createBotSpeaker>[0];
type Generated = Awaited<ReturnType<SpeakerInput['generate']>>;
/** A language answer as a test writes it: a finished phrase list, or a source. */
type TestAnswer = {
  readonly value: { readonly phrases: readonly string[] | PhraseSource };
  readonly settle: () => Promise<void>;
  readonly close?: () => Promise<void>;
  readonly abandon?: () => void;
};
/** The speaker's view of a test's answer: a finished list becomes its phrase source. */
export const generated = (answer: TestAnswer): Generated => ({
  value: {
    phrases: Array.isArray(answer.value.phrases)
      ? phraseSourceOf(answer.value.phrases as readonly string[])
      : (answer.value.phrases as PhraseSource),
  },
  settle: answer.settle,
  close: answer.close ?? (async () => undefined),
  abandon: answer.abandon ?? (() => undefined),
});
/** What the hearing reports of the one peer; each ended turn is a later instant. */
let spokeUntilMs = 0;
export const peerSaid = (
  kind: PeerActivity['kind'],
  peer = 'peer',
): PeerActivity =>
  kind === 'end-of-turn'
    ? { kind, peer, spokeUntilMs: (spokeUntilMs += 1000), spokeForMs: 800 }
    : { kind, peer };
/**
 * One-shot timers for a speaker under test. The short pause after a refusal
 * ends when the test next wakes the speaker (`resume`), as the next pulse
 * would find it; the wait for a reply to a question ends only when the test
 * lets it elapse.
 */
export function testTimer() {
  const pauses: (() => void)[] = [];
  const replies: (() => void)[] = [];
  const run = (pending: (() => void)[]) => {
    for (const due of pending.splice(0)) due();
  };
  return {
    timer: {
      setTimeout: (due: () => void, ms: number) => {
        (ms <= 3000 ? pauses : replies).push(due);
        return due;
      },
      clearTimeout: (handle: unknown) => {
        for (const pending of [pauses, replies]) {
          const at = pending.indexOf(handle as () => void);
          if (at >= 0) pending.splice(at, 1);
        }
      },
    },
    /** The pause after a refusal is over. */
    resume: () => run(pauses),
    /** The question has met silence for long enough. */
    elapse: () => run(replies),
  };
}
const budgetRefusals = new WeakSet<Error>();
/** The provider budget's own refusal, as the speaker is told to recognise it. */
export const budgetFull = () => {
  const refusal = createAppError('CONFLICT', 'Provider capacity unavailable');
  budgetRefusals.add(refusal);
  return refusal;
};
export const isBudgetFull = (error: unknown) =>
  error instanceof Error && budgetRefusals.has(error);
export const job = (phraseId: string, text: string, samples = 240) => ({
  scope,
  token: 'memory-only',
  phraseId,
  text,
  pcm: new Int16Array(samples),
  sampleRate: 24000 as const,
  channels: 1 as const,
});
/** A speaker over in-memory stubs; publication waits on `release` unless overridden. */
export function harness(
  segmentType: 'speech' | 'cross_ex',
  options: {
    readonly opensExchange?: boolean;
    readonly generate?: (
      to: Parameters<SpeakerInput['generate']>[3],
    ) => Promise<TestAnswer>;
    readonly heard?: SpeakerInput['heard'];
    readonly synthesize?: (
      phraseId: string,
      text: string,
      signal: AbortSignal,
    ) => ReturnType<SpeakerInput['synthesize']>;
    readonly publish?: SpeakerInput['publish'];
    readonly deadline?: SpeakerInput['deadline'];
    readonly lineClosed?: SpeakerInput['lineClosed'];
    readonly tailCut?: SpeakerInput['tailCut'];
    readonly audible?: SpeakerInput['audible'];
  } = {},
) {
  const log: string[] = [];
  /** Phrases authorized ahead, as `text:lineId`, in order. */
  const prepared: string[] = [];
  const failures: unknown[] = [];
  let ids = 0;
  const gates: ReturnType<typeof Promise.withResolvers<void>>[] = [];
  const timers = testTimer();
  const speaker = createBotSpeaker({
    claim: {
      scope,
      token: 'memory-only',
      segmentType,
      opensExchange: options.opensExchange ?? true,
    },
    generate: async (_scope, _token, _signal, to) =>
      generated(
        options.generate
          ? await options.generate(to)
          : (log.push('generate'),
            answered({ text: 'One. Two.', phrases: ['One.', 'Two.'] })),
      ),
    heard: options.heard ?? (async () => undefined),
    timer: timers.timer,
    synthesize: async (_scope, _token, phraseId, text, signal) => {
      log.push(`tts:${text}`);
      return options.synthesize
        ? options.synthesize(phraseId, text, signal)
        : answered(job(phraseId, text));
    },
    lineClosed: options.lineClosed ?? (() => false),
    tailCut: options.tailCut ?? (() => false),
    writeAhead: (job) => {
      prepared.push(`${job.text}:${job.phraseId}`);
    },
    discard: () => undefined,
    audible: options.audible ?? (() => false),
    silence: () => {
      log.push('silence');
    },
    deadline:
      options.deadline ??
      (async () => {
        log.push('deadline');
        return 1e12;
      }),
    publish:
      options.publish ??
      (async (job, signal) => {
        const gate = Promise.withResolvers<void>();
        gates.push(gate);
        signal.addEventListener('abort', () => gate.reject(signal.reason));
        log.push(`publish:${job.text}`);
        await gate.promise;
        return { complete: true, segmentEnded: false };
      }),
    nextId: () => `phrase-${++ids}`,
    maxAttempts: 2,
    busy: isBudgetFull,
    failed: (_error, stage) => {
      failures.push(stage);
    },
  });
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  const release = async () => {
    await settle();
    gates.shift()?.resolve();
    await settle();
  };
  return {
    // A test's wake is the pulse after any pause: the pause is over by then.
    speaker: {
      ...speaker,
      wake: () => {
        timers.resume();
        speaker.wake();
      },
    },
    log,
    release,
    settle,
    failures: () => failures.length,
    prepared,
    stages: () => failures,
    elapse: timers.elapse,
  };
}
