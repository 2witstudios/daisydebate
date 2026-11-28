import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  initialSpeechState,
  nextSpeechState,
  nextSpeechWork,
  phraseAt,
} from './speech-state';
setupRitewayBun();
const rules = { crossEx: false, asks: true, maxAttempts: 3 };
describe('bot speech state', () => {
  test('received work survives a deferral but stale completions cannot revive a replaced turn', () => {
    let state = initialSpeechState(rules);
    const generation = state.generation;
    state = nextSpeechState(state, {
      type: 'language-requested',
      generation,
    }).state;
    state = nextSpeechState(state, {
      type: 'language-received',
      generation,
    }).state;
    assert({
      given: 'a received language answer',
      should: 'settle the same receipt instead of buying another',
      actual: nextSpeechWork(state, { text: 'words' }),
      expected: { type: 'settle-language' },
    });
    state = nextSpeechState(state, { type: 'reset' }).state;
    state = nextSpeechState(state, {
      type: 'language-received',
      generation,
    }).state;
    assert({
      given: 'a completion belonging to the replaced generation',
      should: 'leave the new turn unbought',
      actual: nextSpeechWork(state, { text: 'words' }),
      expected: { type: 'generate' },
    });
  });
  test('a queued tail cut rewinds to the prior paid voice and preserves the failed next phrase', () => {
    let state = initialSpeechState(rules);
    const generation = state.generation;
    for (const index of [0, 1]) {
      state = nextSpeechState(state, {
        type: 'voice-requested',
        generation,
        index,
        lineId: `line${index}`,
      }).state;
      state = nextSpeechState(state, {
        type: 'voice-received',
        generation,
        index,
        durationMs: 600,
      }).state;
      state = nextSpeechState(state, {
        type: 'voice-settled',
        generation,
        index,
      }).state;
    }
    state = nextSpeechState(state, { type: 'phrase-sent', generation }).state;
    state = nextSpeechState(state, { type: 'tail-cut', generation }).state;
    assert({
      given: 'the previous phrase whose queued tail was cut',
      should: 'resume its paid voice under a new line',
      actual: {
        cursor: state.turn.cursor,
        voice: phraseAt(state, 0)?.status,
        line: phraseAt(state, 0)?.lineId,
      },
      expected: { cursor: 0, voice: 'settled', line: null },
    });
    assert({
      given: 'the next phrase already bought before the cut',
      should: 'retain its settled receipt for later',
      actual: phraseAt(state, 1)?.status,
      expected: 'settled',
    });
  });
  test('a voice still settling is awaited before its receipt is retried', () => {
    let state = initialSpeechState(rules);
    const generation = state.generation;
    for (const type of [
      'language-requested',
      'language-received',
      'language-settled',
    ] as const)
      state = nextSpeechState(state, { type, generation }).state;
    state = nextSpeechState(state, {
      type: 'voice-requested',
      generation,
      index: 0,
      lineId: 'line',
    }).state;
    state = nextSpeechState(state, {
      type: 'voice-received',
      generation,
      index: 0,
      durationMs: 500,
    }).state;
    state = nextSpeechState(state, {
      type: 'voice-settling',
      generation,
      index: 0,
    }).state;
    assert({
      given: 'a paid voice whose settlement is still pending',
      should: 'await that attempt instead of settling concurrently',
      actual: nextSpeechWork(state, { text: 'words' }),
      expected: { type: 'await-voice' },
    });
  });
});
