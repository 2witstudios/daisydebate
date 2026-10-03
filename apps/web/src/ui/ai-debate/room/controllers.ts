import {
  createTurnTaking,
  defaultTurnTakingSettings,
  worthTranscribing,
} from '@daisy/ai-voice';
import { aiDebateApi, encodeRecording, type SpeechEvent } from './api';
import type { Playback, Recording } from './audio';
import {
  aborted,
  playLine,
  sleep,
  untilLive,
  type TurnContext,
} from './play-line';

/**
 * The AI's speech: written by the model as it streams (from the countdown,
 * so it is ready to speak when the turn begins), voiced a sentence at a
 * time. When the AI finishes before the clock, `onFinishedEarly` yields the
 * turn; when the clock runs out first, the voice stops mid-sentence.
 */
export async function runAiSpeech(
  context: TurnContext,
  onFinishedEarly: () => void,
) {
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
  if (!(await untilLive(context))) return;
  if (sentences.length === 0)
    context.onStatus('Your opponent is gathering their thoughts…');
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
  if (!(await untilLive(context))) return;
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

  type Exchange = Awaited<ReturnType<typeof aiDebateApi.crossExamine>>;
  const exchange = async (pending: () => Promise<Exchange | null>) => {
    live.busy = true;
    context.onStatus('Thinking…');
    try {
      const result = await pending();
      if (!result) return;
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

  const send = (clip: Recording) =>
    exchange(async () => {
      const recorded = await clip.stop();
      if (!worthTranscribing(recorded)) return null;
      return aiDebateApi.crossExamine(
        context.id,
        context.turnIndex,
        await encodeRecording(recorded.blob),
      );
    });

  // The AI's opening question is prepared during the countdown.
  const opening = aiAsks
    ? aiDebateApi.crossExamine(context.id, context.turnIndex)
    : null;
  opening?.catch(() => undefined);
  if (!(await untilLive(context))) return;
  if (opening) await exchange(() => opening);
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
