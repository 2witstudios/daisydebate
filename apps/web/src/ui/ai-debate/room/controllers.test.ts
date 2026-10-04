import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { runAiSpeech } from './controllers';
import {
  fakeApi,
  fakeEngine,
  handClock,
  settle,
  turnContext,
  until,
} from './room.test-support';

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
    const engine = fakeEngine(log);
    const context = turnContext({
      api,
      engine,
      onCaption: (text) => captions.push(text),
      onError: (problem) => problems.push(problem),
    });
    await until(
      engine,
      runAiSpeech(context, () => {
        yielded = true;
      }),
    );
    assert({
      given: 'a speech whose first sentence cannot be voiced',
      should: 'say so, voice the rest and yield when it is done',
      actual: { captions, told: problems.length > 0, yielded },
      expected: { captions: ['Two.', 'Three.'], told: true, yielded: true },
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
    const engine = fakeEngine(log);
    const speaking = runAiSpeech(
      turnContext({ api, engine, live }),
      () => undefined,
    );
    await settle();
    const beforeLive = [...fetched];
    goLive();
    await until(engine, speaking);
    assert({
      given: 'a speech written during the countdown',
      should: 'have its first three phrases voiced before the turn begins',
      actual: beforeLive,
      expected: [0, 1, 2],
    });
  });
});
