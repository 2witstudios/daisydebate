import type { Clock } from '@daisy/clock';
import type { AiDebateCommand } from '@daisy/debate-engine';
import type { AiDebateApi, SpeechEvent } from './api';
import type { AudioEngine, Playback } from './audio';

export const T0 = Date.UTC(2026, 9, 3, 18, 0, 0);

/** A clock the test moves by hand. */
export const handClock = (start = T0) => {
  let now = start;
  const clock: Clock = { now: () => new Date(now).toISOString() };
  return { clock, at: () => now, advance: (ms: number) => (now += ms) };
};

/** Timers the test fires by hand. */
export const handTimers = () => {
  const live = new Set<() => void>();
  return {
    every: (run: () => void) => {
      live.add(run);
      return () => live.delete(run);
    },
    fire: () => {
      for (const run of [...live]) run();
    },
    count: () => live.size,
  };
};

/** Lets pending promise callbacks run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const playback = (): Playback => ({
  finished: Promise.resolve(),
  durationMs: 100,
  playedMs: () => 100,
  stop: () => undefined,
});

/** An audio engine that records into a log instead of a microphone. */
export const fakeEngine = (log: string[]): AudioEngine => ({
  level: () => 0.05,
  record: () => {
    log.push('record');
    return {
      stop: async () => {
        log.push('stop');
        return {
          blob: new Blob(['voice'], { type: 'audio/webm' }),
          voicedMs: 2_000,
        };
      },
    };
  },
  play: async () => playback(),
  chime: () => undefined,
  usingHeadset: async () => true,
  close: () => log.push('close'),
});

type ApiOverrides = Partial<AiDebateApi>;

/** An AI debate API over an in-memory command log, logging each call. */
export const fakeApi = ({
  log,
  at,
  personSide = 'affirmative',
  commands = [],
  overrides = {},
}: {
  readonly log: string[];
  readonly at: () => number;
  readonly personSide?: 'affirmative' | 'negative';
  readonly commands?: AiDebateCommand[];
  readonly overrides?: ApiOverrides;
}): AiDebateApi => ({
  view: async (id) => ({
    id,
    resolution: 'Schools should ban phones in class.',
    personSide,
    opponent: 'wren',
    voice: 'bf_emma',
    serverNow: at(),
    commands: [...commands],
    utterances: [],
    ballot: null,
  }),
  command: async (_id, _sequence, command) => {
    log.push(`command:${command.type}`);
    const time = at();
    commands.push(
      command.type === 'yield'
        ? { type: 'yield', at: time, turnIndex: command.turnIndex }
        : command.type === 'abort'
          ? { type: 'abort', at: time, reason: 'person' }
          : { type: command.type, at: time },
    );
  },
  transcribe: async () => {
    log.push('transcribe');
    return { text: 'words' };
  },
  speech: async (
    _id: string,
    _turn: number,
    onEvent: (event: SpeechEvent) => void,
  ) => {
    onEvent({ type: 'done' });
  },
  speak: async () => new ArrayBuffer(1),
  crossExamine: async () => ({ heard: '', reply: null }),
  heard: async () => undefined,
  ballot: async () => {
    throw new Error('no ballot in this test');
  },
  ...overrides,
});
