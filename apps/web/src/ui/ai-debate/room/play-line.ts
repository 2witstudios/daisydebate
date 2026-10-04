import type { AiDebateApi } from './api';
import type { AudioEngine, Playback } from './audio';

/** What a turn's controller is given: its debate, audio and lifetime. */
export type TurnContext = {
  readonly id: string;
  readonly turnIndex: number;
  readonly api: AiDebateApi;
  readonly engine: AudioEngine;
  /** Aborted when the turn ends (by time, a yield or leaving the page). */
  readonly signal: AbortSignal;
  /** Resolves when the turn goes live, after its countdown or prep. */
  readonly live: Promise<void>;
  /** Something was added to the transcript: refresh the view. */
  readonly onLine: () => void;
  readonly onStatus: (status: string) => void;
  readonly onCaption: (text: string) => void;
  /** The opponent's voice started or stopped. */
  readonly onSpeaking: (speaking: boolean) => void;
  readonly onError: (message: string) => void;
  /** Registers how to wrap up the turn early (the person's own speech). */
  readonly setFinish: (finish: () => Promise<void>) => void;
};

/** Resolves when the signal aborts. */
export const aborted = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });

export const sleep = (ms: number, signal: AbortSignal) =>
  Promise.race([
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
    aborted(signal),
  ]);

const SKIPPED = Symbol('skipped');

/** The breath between one phrase and the next, in milliseconds. */
const BREATH_MS = 80;
/** Phrases whose voice is fetched ahead of the one being scheduled. */
const PREFETCH = 3;

type Scheduled = { readonly index: number; readonly playback: Playback };

/**
 * Plays an AI line phrase by phrase, each starting a short breath after the
 * last ends on the audio timeline, so nothing waits on the network between
 * phrases: the next phrase's voice is fetched while this one plays, and it
 * is decoded and queued before this one ends. Resolves to how far it got if
 * cut off. A phrase whose voice fails to load or decode is skipped with a
 * notice, so one bad clip never silences the rest of the line.
 */
export async function playLine({
  context,
  utteranceId,
  phraseAt,
  stopWhen,
  setPlaying,
}: {
  readonly context: TurnContext;
  readonly utteranceId: () => string | null;
  /** Waits for phrase `index`; resolves to null when the line has no more. */
  readonly phraseAt: (index: number) => Promise<string | null>;
  /** Resolves when playback must stop (the turn ended, or a barge-in). */
  readonly stopWhen: Promise<void>;
  readonly setPlaying?: (playback: Playback | null) => void;
}): Promise<'finished' | 'stopped'> {
  let stopped = false;
  const { fetchAudio, prefetch } = voices(
    context,
    utteranceId,
    phraseAt,
    () => stopped,
  );
  void stopWhen.then(() => (stopped = true));
  const scheduled: Scheduled[] = [];
  const show = shower(context, setPlaying, () => stopped);
  const cut = () => {
    for (const { playback } of scheduled) playback.stop();
    show.done();
    const playing = scheduled.find(
      ({ playback }) => playback.playedMs() < playback.durationMs,
    );
    if (playing)
      reportHeard(context, utteranceId(), playing.index, playing.playback);
    return 'stopped' as const;
  };
  /** The phrase's voice, queued; null when stopped first; SKIPPED on failure. */
  const voiceOf = async (index: number, at: number) => {
    try {
      const clip = await Promise.race([
        fetchAudio(index),
        stopWhen.then(() => null),
      ]);
      return clip ? await context.engine.play(clip, at) : null;
    } catch {
      context.onError("Part of your opponent's speech could not be voiced.");
      return SKIPPED;
    }
  };
  let nextAt = 0;
  for (let index = 0; ; index += 1) {
    const text = await Promise.race([
      phraseAt(index),
      stopWhen.then(() => null),
    ]);
    if (stopped) return cut();
    if (text === null) break;
    prefetch(index + 1);
    const playback = await voiceOf(index, nextAt);
    if (playback === SKIPPED) continue;
    if (stopped || !playback) return cut();
    scheduled.push({ index, playback });
    show.at(playback, text);
    nextAt = playback.endsAt + BREATH_MS;
    // Keep one phrase queued behind the one playing, no more.
    await Promise.race([ended(scheduled.at(-2)), stopWhen]);
    if (stopped) return cut();
  }
  await Promise.race([ended(scheduled.at(-1)), stopWhen]);
  if (stopped) return cut();
  show.done();
  return 'finished';
}

/** Resolves when a queued phrase has played (at once when there is none). */
const ended = (entry: Scheduled | undefined) =>
  entry ? entry.playback.finished : Promise.resolve();

/** Each phrase's voice, fetched once, and fetched ahead of need. */
function voices(
  context: TurnContext,
  utteranceId: () => string | null,
  phraseAt: (index: number) => Promise<string | null>,
  stopped: () => boolean,
) {
  const audio = new Map<number, Promise<ArrayBuffer>>();
  const fetchAudio = (index: number) => {
    const id = utteranceId();
    if (!id) return Promise.reject(new Error('no line'));
    let pending = audio.get(index);
    if (!pending) {
      pending = context.api.speak(context.id, id, index);
      pending.catch(() => undefined);
      audio.set(index, pending);
    }
    return pending;
  };
  const prefetch = (from: number) => {
    for (let index = from; index < from + PREFETCH; index += 1)
      void phraseAt(index).then((next) => {
        if (next !== null && !stopped())
          void fetchAudio(index).catch(() => undefined);
      });
  };
  return { fetchAudio, prefetch };
}

/** Shows each phrase's caption, and that the opponent speaks, as it starts. */
function shower(
  context: TurnContext,
  setPlaying: ((playback: Playback | null) => void) | undefined,
  stopped: () => boolean,
) {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  return {
    at(playback: Playback, text: string) {
      const timer = setTimeout(
        () => {
          timers.delete(timer);
          if (stopped()) return;
          setPlaying?.(playback);
          context.onSpeaking(true);
          context.onCaption(text);
        },
        Math.max(0, playback.startsAt - context.engine.now()),
      );
      timers.add(timer);
    },
    done() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      setPlaying?.(null);
      context.onSpeaking(false);
    },
  };
}

/** Tells the server how much of a cut-off line was heard. */
function reportHeard(
  context: TurnContext,
  id: string | null,
  phraseIndex: number,
  playback: Playback,
) {
  if (!id) return;
  void context.api
    .heard({
      id: context.id,
      utteranceId: id,
      phraseIndex,
      playedMs: Math.round(playback.playedMs()),
      totalMs: Math.round(playback.durationMs),
    })
    .catch(() => undefined);
}

/** Waits for the turn to go live; false when it ended first. */
export async function untilLive(context: TurnContext) {
  await Promise.race([context.live, aborted(context.signal)]);
  return !context.signal.aborted;
}
