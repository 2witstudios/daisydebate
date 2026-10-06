import {
  createTurnTaking,
  defaultTurnTakingSettings,
  worthTranscribing,
} from '@daisy/ai-voice';
import {
  recordInSegments,
  sendIfVoiced,
  type Recording,
} from '../../speech/segments';
import { encodeRecording, type SpeechEvent } from './api';
import type { Playback } from './audio';
import {
  aborted,
  playLine,
  sleep,
  untilLive,
  type TurnContext,
  createVoices,
} from './play-line';

/**
 * The AI's speech: written by the model as it streams (from the countdown,
 * so it is ready to speak when the turn begins), voiced a phrase at a
 * time. When the AI finishes before the clock, `onFinishedEarly` yields the
 * turn; when the clock runs out first, the voice stops mid-sentence.
 */
export async function runAiSpeech(
  context: TurnContext,
  onFinishedEarly: () => void,
) {
  let utteranceId: string | null = null;
  const phrases: string[] = [];
  let done = false;
  let failed = false;
  const waiters: Array<() => void> = [];
  const wake = () => {
    for (const waiter of waiters.splice(0)) waiter();
  };
  const phraseAt = async (index: number): Promise<string | null> => {
    for (;;) {
      if (index < phrases.length) return phrases[index]!;
      if (done || context.signal.aborted) return null;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  void context.api
    .speech(
      context.id,
      context.turnIndex,
      (event: SpeechEvent) => {
        if (event.type === 'utterance') utteranceId = event.id;
        else if (event.type === 'phrase') phrases[event.index] = event.text;
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
  // Voice the opening phrases during the countdown, so the first words are
  // in hand when the turn begins and the second follows without a wait.
  const voices = createVoices(
    context,
    () => utteranceId,
    phraseAt,
    () => context.signal.aborted,
  );
  voices.prefetch(0);
  if (!(await untilLive(context))) return;
  if (phrases.length === 0)
    context.onStatus('Your opponent is gathering their thoughts…');
  const first = await Promise.race([
    phraseAt(0),
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
    phraseAt,
    stopWhen: aborted(context.signal),
    voices,
  });
  context.onLine();
  if (failed) context.onError("Part of your opponent's speech failed to load.");
  if (outcome === 'finished' && !context.signal.aborted) onFinishedEarly();
}

/**
 * The person's speech: recorded in segments, each transcribed as it ends,
 * side by side. Ending the speech early (`setFinish`) stops and sends the
 * last segment while the turn is still live, so its words are never lost
 * to the end of the turn.
 */
export async function runPersonSpeech(
  context: TurnContext,
  segmentMs = 30_000,
) {
  if (!(await untilLive(context))) return;
  context.onStatus('You have the floor. Your speech is being recorded.');
  const speech = recordInSegments({
    record: () => context.engine.record(),
    upload: (recording) => transcribeClip(context, recording),
    segmentMs,
    wait: sleep,
    signal: context.signal,
  });
  context.setFinish(speech.finish);
  await speech.done;
}

/** Stops a recording and sends it for transcription if it holds a voice. */
async function transcribeClip(context: TurnContext, recording: Recording) {
  try {
    const sent = await sendIfVoiced(recording, async (blob) => {
      await context.api.transcribe(
        context.id,
        context.turnIndex,
        await encodeRecording(blob),
      );
    });
    if (sent) context.onLine();
  } catch {
    context.onError('Part of your speech could not be transcribed.');
  }
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
    reply: { utteranceId: string; phrases: string[] } | null,
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
      phraseAt: async (index) => reply.phrases[index] ?? null,
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

  type Exchange = Awaited<ReturnType<typeof context.api.crossExamine>>;
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
      return context.api.crossExamine(
        context.id,
        context.turnIndex,
        await encodeRecording(recorded.blob),
      );
    });

  // The AI's opening question is prepared during the countdown.
  const opening = aiAsks
    ? context.api.crossExamine(context.id, context.turnIndex)
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
      await context.api
        .crossExamine(
          context.id,
          context.turnIndex,
          await encodeRecording(blob),
        )
        .catch(() => undefined);
  }
}
