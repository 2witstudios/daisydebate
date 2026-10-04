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

/**
 * Plays an AI line sentence by sentence; resolves to how far it got if cut
 * off. A sentence whose voice fails to load or decode is skipped with a
 * notice, so one bad clip never silences the rest of the line.
 */
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
      pending = context.api.speak(context.id, id, index);
      pending.catch(() => undefined);
      audio.set(index, pending);
    }
    return pending;
  };
  let stopped = false;
  void stopWhen.then(() => (stopped = true));
  /** The sentence's voice, playing; null when stopped first; SKIPPED on failure. */
  const voiceOf = async (index: number) => {
    try {
      const clip = await Promise.race([
        fetchAudio(index),
        stopWhen.then(() => null),
      ]);
      return clip ? await context.engine.play(clip) : null;
    } catch {
      context.onError("Part of your opponent's speech could not be voiced.");
      return SKIPPED;
    }
  };
  for (let index = 0; ; index += 1) {
    const text = await Promise.race([
      sentenceAt(index),
      stopWhen.then(() => null),
    ]);
    if (stopped) return 'stopped';
    if (text === null) return 'finished';
    // Fetch the next sentence's voice while this one plays.
    void sentenceAt(index + 1).then((next) => {
      if (next !== null && !stopped)
        void fetchAudio(index + 1).catch(() => undefined);
    });
    const playback = await voiceOf(index);
    if (playback === SKIPPED) continue;
    if (stopped || !playback) return 'stopped';
    if (await played(context, playback, text, stopWhen, setPlaying)) continue;
    playback.stop();
    reportHeard(context, utteranceId(), index, playback);
    return 'stopped';
  }
}

/** Plays one clip with its caption; false when cut off first. */
async function played(
  context: TurnContext,
  playback: Playback,
  text: string,
  stopWhen: Promise<void>,
  setPlaying?: (playback: Playback | null) => void,
) {
  let cut = false;
  setPlaying?.(playback);
  context.onSpeaking(true);
  context.onCaption(text);
  await Promise.race([playback.finished, stopWhen.then(() => (cut = true))]);
  context.onSpeaking(false);
  setPlaying?.(null);
  return !cut;
}

/** Tells the server how much of a cut-off line was heard. */
function reportHeard(
  context: TurnContext,
  id: string | null,
  sentenceIndex: number,
  playback: Playback,
) {
  if (!id) return;
  void context.api
    .heard({
      id: context.id,
      utteranceId: id,
      sentenceIndex,
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
