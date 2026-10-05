import type { Clock } from '@daisy/clock';
import type { AiDebateCommand } from '@daisy/debate-engine';
import type { AiDebateApi, SpeechEvent } from './api';
import type { AudioEngine, Playback } from './audio';
import type { TurnContext } from './play-line';

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

export type FakeEngine = AudioEngine & {
  /** Moves the timeline on by `ms`, running everything due on the way. */
  advance(ms: number): Promise<void>;
  /** Every clip played, in order, with whether it was stopped. */
  readonly clips: { startsAt: number; stopped: boolean }[];
};

/**
 * An audio engine that records into a log instead of a microphone, on a
 * timeline the test moves by hand (`advance`), so timing is exact. Every
 * clip lasts 100 ms and starts when it was scheduled (or now, if that has
 * passed). `onPlay` sees each requested start; `decoding` holds a clip back
 * the way a slow decode does.
 */
export const fakeEngine = (
  log: string[],
  {
    onPlay = () => undefined,
    decoding = async () => undefined,
  }: {
    readonly onPlay?: (at: number) => void;
    readonly decoding?: () => Promise<void>;
  } = {},
): FakeEngine => {
  let now = 0;
  const due: { at: number; run: () => void }[] = [];
  const at = (time: number, run: () => void) => {
    const entry = { at: time, run };
    due.push(entry);
    return () => {
      const index = due.indexOf(entry);
      if (index >= 0) due.splice(index, 1);
    };
  };
  const clips: FakeEngine['clips'] = [];
  return {
    clips,
    level: () => 0.05,
    now: () => now,
    at,
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        await settle();
        const next = due
          .filter((entry) => entry.at <= target)
          .sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        due.splice(due.indexOf(next), 1);
        now = Math.max(now, next.at);
        next.run();
      }
      now = target;
      await settle();
    },
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
    play: async (_mp3, start = 0) => {
      onPlay(start);
      await decoding();
      const startsAt = Math.max(start, now);
      const clip = { startsAt, stopped: false };
      clips.push(clip);
      let stoppedAt: number | null = null;
      let end: () => void = () => undefined;
      const finished = new Promise<void>((resolve) => (end = resolve));
      at(startsAt + 100, end);
      const playback: Playback = {
        finished,
        startsAt,
        endsAt: startsAt + 100,
        durationMs: 100,
        playedMs: () =>
          Math.min(100, Math.max(0, (stoppedAt ?? now) - startsAt)),
        stop: () => {
          stoppedAt ??= now;
          clip.stopped = true;
          end();
        },
      };
      return playback;
    },
    chime: () => undefined,
    usingHeadset: async () => true,
    close: () => log.push('close'),
  };
};

/** Moves the timeline on until `work` settles, and answers its result. */
export async function until<T>(engine: FakeEngine, work: Promise<T>) {
  let settled = false;
  void work.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let step = 0; !settled; step += 1) {
    if (step > 2_000) throw new Error('the work never settled');
    await engine.advance(10);
  }
  return work;
}

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
    voice: 'aura-2-thalia-en',
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

/** A turn's context with every callback a no-op unless given. */
export const turnContext = (
  given: Pick<TurnContext, 'api' | 'engine'> & Partial<TurnContext>,
): TurnContext => ({
  id: 'd1',
  turnIndex: 2,
  signal: new AbortController().signal,
  live: Promise.resolve(),
  onLine: () => undefined,
  onStatus: () => undefined,
  onCaption: () => undefined,
  onSpeaking: () => undefined,
  onError: () => undefined,
  setFinish: () => undefined,
  ...given,
});
