import { aiDebateApi } from './api';
import type { AudioEngine, Playback } from './audio';

/** What a turn's controller is given: its debate, audio and lifetime. */
export type TurnContext = {
  readonly id: string;
  readonly turnIndex: number;
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

/** Plays an AI line sentence by sentence; resolves to how far it got if cut off. */
export async function playLine({
  context,
  utteranceId,
  sentenceAt,
  stopWhen,
  setPlaying,
}: {
  readonly context: TurnContext;
  readonly utteranceId: () => string | null;
  /** Waits for sentence `index`; resolves to null when the line has no more. */
  readonly sentenceAt: (index: number) => Promise<string | null>;
  /** Resolves when playback must stop (the turn ended, or a barge-in). */
  readonly stopWhen: Promise<void>;
  readonly setPlaying?: (playback: Playback | null) => void;
}): Promise<'finished' | 'stopped'> {
  const audio = new Map<number, Promise<ArrayBuffer>>();
  const fetchAudio = (index: number) => {
    const id = utteranceId();
    if (!id) return Promise.reject(new Error('no line'));
    let pending = audio.get(index);
    if (!pending) {
      pending = aiDebateApi.speak(context.id, id, index);
      pending.catch(() => undefined);
      audio.set(index, pending);
    }
    return pending;
  };
  let stopped = false;
  void stopWhen.then(() => (stopped = true));
  for (let index = 0; ; index += 1) {
    const text = await Promise.race([
      sentenceAt(index),
      stopWhen.then(() => null),
    ]);
    if (stopped) return 'stopped';
    if (text === null) return 'finished';
    const clip = await Promise.race([
      fetchAudio(index),
      stopWhen.then(() => null),
    ]);
    if (stopped || !clip) return 'stopped';
    // Fetch the next sentence's voice while this one plays.
    void sentenceAt(index + 1).then((next) => {
      if (next !== null && !stopped)
        void fetchAudio(index + 1).catch(() => undefined);
    });
    const playback = await context.engine.play(clip);
    setPlaying?.(playback);
    context.onSpeaking(true);
    context.onCaption(text);
    await Promise.race([playback.finished, stopWhen]);
    context.onSpeaking(false);
    setPlaying?.(null);
    if (stopped) {
      playback.stop();
      const id = utteranceId();
      if (id)
        void aiDebateApi
          .heard({
            id: context.id,
            utteranceId: id,
            sentenceIndex: index,
            playedMs: Math.round(playback.playedMs()),
            totalMs: Math.round(playback.durationMs),
          })
          .catch(() => undefined);
      return 'stopped';
    }
  }
}

/** Waits for the turn to go live; false when it ended first. */
export async function untilLive(context: TurnContext) {
  await Promise.race([context.live, aborted(context.signal)]);
  return !context.signal.aborted;
}
