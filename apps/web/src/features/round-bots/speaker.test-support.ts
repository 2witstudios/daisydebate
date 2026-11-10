import { createBotSpeaker } from './speaker';

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
export const job = (phraseId: string, text: string, samples = 240) => ({
  scope,
  token: 'memory-only',
  phraseId,
  text,
  pcm: new Int16Array(samples),
  sampleRate: 24000 as const,
  channels: 1 as const,
});
type SpeakerInput = Parameters<typeof createBotSpeaker>[0];
/** A speaker over in-memory stubs; publication waits on `release` unless overridden. */
export function harness(
  segmentType: 'speech' | 'cross_ex',
  options: {
    readonly opensExchange?: boolean;
    readonly generate?: () => Promise<
      ReturnType<typeof answered<{ text: string; phrases: string[] }>>
    >;
    readonly synthesize?: (
      phraseId: string,
      text: string,
      signal: AbortSignal,
    ) => ReturnType<SpeakerInput['synthesize']>;
    readonly publish?: SpeakerInput['publish'];
    readonly deadline?: SpeakerInput['deadline'];
    readonly lineClosed?: SpeakerInput['lineClosed'];
    readonly audible?: SpeakerInput['audible'];
  } = {},
) {
  const log: string[] = [];
  /** Phrases authorized ahead, as `text:lineId`, in order. */
  const prepared: string[] = [];
  const failures: unknown[] = [];
  let ids = 0;
  const gates: ReturnType<typeof Promise.withResolvers<void>>[] = [];
  const speaker = createBotSpeaker({
    claim: {
      scope,
      token: 'memory-only',
      segmentType,
      opensExchange: options.opensExchange ?? true,
    },
    generate:
      options.generate ??
      (async () => {
        log.push('generate');
        return answered({ text: 'One. Two.', phrases: ['One.', 'Two.'] });
      }),
    synthesize: async (_scope, _token, phraseId, text, signal) => {
      log.push(`tts:${text}`);
      return options.synthesize
        ? options.synthesize(phraseId, text, signal)
        : answered(job(phraseId, text));
    },
    lineClosed: options.lineClosed ?? (() => false),
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
    speaker,
    log,
    release,
    settle,
    failures: () => failures.length,
    prepared,
    stages: () => failures,
  };
}
