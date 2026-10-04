import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { runAiSpeech } from './controllers';
import { playLine } from './play-line';
import type { TurnContext } from './play-line';
import { fakeApi, fakeEngine, handClock, settle } from './room.test-support';

setupRitewayBun();

describe('runAiSpeech', () => {
  test('a voice clip that fails is skipped and the bot carries on', async () => {
    const log: string[] = [];
    const time = handClock();
    const captions: string[] = [];
    const problems: string[] = [];
    let yielded = false;
    const api = fakeApi({
      log,
      at: time.at,
      overrides: {
        speech: async (_id, _turn, onEvent) => {
          onEvent({ type: 'utterance', id: 'line-1' });
          ['One.', 'Two.', 'Three.'].forEach((text, index) =>
            onEvent({ type: 'phrase', index, text }),
          );
          onEvent({ type: 'done' });
        },
        speak: async (_id, _line, index) => {
          if (index === 0) throw new Error('voice failed');
          return new ArrayBuffer(1);
        },
      },
    });
    const context: TurnContext = {
      id: 'd1',
      turnIndex: 2,
      api,
      engine: fakeEngine(log),
      signal: new AbortController().signal,
      live: Promise.resolve(),
      onLine: () => undefined,
      onStatus: () => undefined,
      onCaption: (text) => captions.push(text),
      onSpeaking: () => undefined,
      onError: (problem) => problems.push(problem),
      setFinish: () => undefined,
    };
    await runAiSpeech(context, () => {
      yielded = true;
    });
    assert({
      given: 'a speech whose first sentence cannot be voiced',
      should: 'say so, voice the rest and yield when it is done',
      actual: { captions, told: problems.length > 0, yielded },
      expected: { captions: ['Two.', 'Three.'], told: true, yielded: true },
    });
  });
});

describe('playLine', () => {
  test('schedules each phrase a short breath after the one before', async () => {
    const log: string[] = [];
    const starts: number[] = [];
    const time = handClock();
    const engine = fakeEngine(log, { onPlay: (at) => starts.push(at) });
    const api = fakeApi({ log, at: time.at });
    const phrases = ['One.', 'Two, three.', 'Four.'];
    const outcome = await playLine({
      context: {
        id: 'd1',
        turnIndex: 2,
        api,
        engine,
        signal: new AbortController().signal,
        live: Promise.resolve(),
        onLine: () => undefined,
        onStatus: () => undefined,
        onCaption: () => undefined,
        onSpeaking: () => undefined,
        onError: () => undefined,
        setFinish: () => undefined,
      },
      utteranceId: () => 'line-1',
      phraseAt: async (index) => phrases[index] ?? null,
      stopWhen: new Promise(() => undefined),
    });
    assert({
      given: 'three 100 ms phrases',
      should: 'start each 80 ms after the last one ends, and finish',
      actual: {
        outcome,
        breaths: starts
          .slice(1)
          .map((start, index) => Math.round(start - (starts[index]! + 100))),
      },
      expected: { outcome: 'finished', breaths: [80, 80] },
    });
  });
});

describe('runAiSpeech, in the countdown', () => {
  test('fetches the first phrases’ voices before the turn goes live', async () => {
    const log: string[] = [];
    const time = handClock();
    const fetched: number[] = [];
    let goLive: () => void = () => undefined;
    const live = new Promise<void>((resolve) => (goLive = resolve));
    const api = fakeApi({
      log,
      at: time.at,
      overrides: {
        speech: async (_id, _turn, onEvent) => {
          onEvent({ type: 'utterance', id: 'line-1' });
          ['One.', 'Two.', 'Three.', 'Four.'].forEach((text, index) =>
            onEvent({ type: 'phrase', index, text }),
          );
          onEvent({ type: 'done' });
        },
        speak: async (_id, _line, index) => {
          fetched.push(index);
          return new ArrayBuffer(1);
        },
      },
    });
    const speaking = runAiSpeech(
      {
        id: 'd1',
        turnIndex: 2,
        api,
        engine: fakeEngine(log),
        signal: new AbortController().signal,
        live,
        onLine: () => undefined,
        onStatus: () => undefined,
        onCaption: () => undefined,
        onSpeaking: () => undefined,
        onError: () => undefined,
        setFinish: () => undefined,
      },
      () => undefined,
    );
    await settle();
    const beforeLive = [...fetched];
    goLive();
    await speaking;
    assert({
      given: 'a speech written during the countdown',
      should: 'have its first three phrases voiced before the turn begins',
      actual: beforeLive,
      expected: [0, 1, 2],
    });
  });
});
