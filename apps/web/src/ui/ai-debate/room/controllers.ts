import {
  createTurnTaking,
  defaultTurnTakingSettings,
  worthTranscribing,
} from '@daisy/ai-voice';
import { aiDebateApi, encodeRecording, type SpeechEvent } from './api';
import type { AudioEngine, Playback, Recording } from './audio';

export type TurnContext = {
  readonly id: string;
  readonly turnIndex: number;
  readonly engine: AudioEngine;
  /** Aborted when the turn ends (by time, a yield or leaving the page). */
  readonly signal: AbortSignal;
  /** Something was added to the transcript: refresh the view. */
  readonly onLine: () => void;
  readonly onStatus: (status: string) => void;
  readonly onCaption: (text: string) => void;
  readonly onError: (message: string) => void;
};

/** Resolves when the signal aborts. */
const aborted = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });

const sleep = (ms: number, signal: AbortSignal) =>
  Promise.race([
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
    aborted(signal),
  ]);

/** Plays an AI line sentence by sentence; resolves to how far it got if cut off. */
async function playLine({
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
    context.onCaption(text);
    await Promise.race([playback.finished, stopWhen]);
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

/**
 * The AI's speech: written by the model as it streams, voiced a sentence at
 * a time. When the AI finishes before the clock, `onFinishedEarly` yields
 * the turn; when the clock runs out first, the voice stops mid-sentence.
 */
export async function runAiSpeech(
  context: TurnContext,
  onFinishedEarly: () => void,
) {
  context.onStatus('Your opponent is preparing to speak…');
  let utteranceId: string | null = null;
  const sentences: string[] = [];
  let done = false;
  let failed = false;
  const waiters: Array<() => void> = [];
  const wake = () => {
    for (const waiter of waiters.splice(0)) waiter();
  };
  const sentenceAt = async (index: number): Promise<string | null> => {
    for (;;) {
      if (index < sentences.length) return sentences[index]!;
      if (done || context.signal.aborted) return null;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  void aiDebateApi
    .speech(
      context.id,
      context.turnIndex,
      (event: SpeechEvent) => {
        if (event.type === 'utterance') utteranceId = event.id;
        else if (event.type === 'sentence') sentences[event.index] = event.text;
        else if (event.type === 'error') failed = true;
        if (event.type === 'done' || event.type === 'error') done = true;
        wake();
      },
      context.signal,
    )
    .catch(() => {
      failed = !context.signal.aborted;
    })
    .finally(() => {
      done = true;
      wake();
    });
  const first = await Promise.race([
    sentenceAt(0),
    aborted(context.signal).then(() => null),
  ]);
  if (first === null) {
    if (failed)
      context.onError(
        'Your opponent could not speak. Try rejoining the debate.',
      );
    return;
  }
  context.onStatus('Your opponent is speaking');
  const outcome = await playLine({
    context,
    utteranceId: () => utteranceId,
    sentenceAt,
    stopWhen: aborted(context.signal),
  });
  context.onLine();
  if (failed) context.onError("Part of your opponent's speech failed to load.");
  if (outcome === 'finished' && !context.signal.aborted) onFinishedEarly();
}

/** The person's speech: recorded in segments, each transcribed as it ends. */
export async function runPersonSpeech(
  context: TurnContext,
  segmentMs = 30_000,
) {
  context.onStatus('You have the floor. Your speech is being recorded.');
  let uploads = Promise.resolve();
  const upload = (recording: Recording) => {
    const clip = recording.stop();
    uploads = uploads.then(async () => {
      const { blob, voicedMs } = await clip;
      if (!worthTranscribing({ voicedMs })) return;
      try {
        await aiDebateApi.transcribe(
          context.id,
          context.turnIndex,
          await encodeRecording(blob),
        );
        context.onLine();
      } catch {
        context.onError('Part of your speech could not be transcribed.');
      }
    });
  };
  while (!context.signal.aborted) {
    const recording = context.engine.record();
    await sleep(segmentMs, context.signal);
    upload(recording);
  }
  await uploads;
}

/**
 * Cross-examination, turn by turn: the browser hears when the person stops
 * talking, sends what they said, and plays the AI's question or answer.
 * Speaking over the AI stops its voice; only what was heard is kept.
 */
export async function runCrossExamination(
  context: TurnContext,
  aiAsks: boolean,
) {
  const machine = createTurnTaking(defaultTurnTakingSettings);
  // Mutable turn state the level loop and the replies share.
  const live: {
    playing: Playback | null;
    recording: Recording | null;
    barge: (() => void) | null;
    busy: boolean;
  } = { playing: null, recording: null, barge: null, busy: false };
  const listening = () =>
    context.onStatus(
      aiAsks
        ? 'Answer the question. Pause when you are done.'
        : 'Ask your question. Pause when you are done.',
    );

  const playReply = async (
    reply: { utteranceId: string; sentences: string[] } | null,
  ) => {
    if (!reply || context.signal.aborted) return;
    context.onStatus(
      aiAsks ? 'Your opponent is asking' : 'Your opponent is answering',
    );
    let stopReply: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => (stopReply = resolve));
    live.barge = stopReply;
    await playLine({
      context,
      utteranceId: () => reply.utteranceId,
      sentenceAt: async (index) => reply.sentences[index] ?? null,
      stopWhen: Promise.race([stopped, aborted(context.signal)]),
      setPlaying: (playback) => {
        live.playing = playback;
      },
    });
    live.barge = null;
    live.playing = null;
    machine.reset();
    context.onLine();
    if (!context.signal.aborted && !live.recording) listening();
  };

  const send = async (clip: Recording | null) => {
    live.busy = true;
    context.onStatus('Thinking…');
    try {
      const recorded = clip ? await clip.stop() : null;
      const audio =
        recorded && worthTranscribing(recorded)
          ? await encodeRecording(recorded.blob)
          : undefined;
      if (clip && !audio) return;
      const result = await aiDebateApi.crossExamine(
        context.id,
        context.turnIndex,
        audio,
      );
      context.onLine();
      await playReply(result.reply);
    } catch {
      context.onError('That exchange failed. Keep going: try again.');
    } finally {
      live.busy = false;
      if (!context.signal.aborted && !live.recording && !live.playing)
        listening();
    }
  };

  if (aiAsks) await send(null);
  else listening();

  const tick = setInterval(() => {
    const event = machine.feed({
      at: performance.now(),
      level: context.engine.level(),
      aiPlaying: live.playing !== null,
    });
    if (event === 'barge-in') {
      live.barge?.();
      live.recording ??= context.engine.record();
      context.onStatus('Go ahead. Pause when you are done.');
    } else if (event === 'speech-start' && !live.busy) {
      live.recording ??= context.engine.record();
    } else if (event === 'end-of-turn' && live.recording && !live.busy) {
      const clip = live.recording;
      live.recording = null;
      void send(clip);
    }
  }, 50);
  await aborted(context.signal);
  clearInterval(tick);
  live.barge?.();
  if (live.recording) {
    const { blob, voicedMs } = await live.recording.stop();
    if (worthTranscribing({ voicedMs }))
      await aiDebateApi
        .crossExamine(
          context.id,
          context.turnIndex,
          await encodeRecording(blob),
        )
        .catch(() => undefined);
  }
}
