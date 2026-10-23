import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createOpenRouter } from './openrouter';
import { OPENROUTER_E2E_PLACEHOLDER, withOpenRouterStub } from './testing';
setupRitewayBun();

const stubbed = createOpenRouter({
  apiKey: OPENROUTER_E2E_PLACEHOLDER,
  fetch: withOpenRouterStub(OPENROUTER_E2E_PLACEHOLDER, () =>
    Promise.reject(new Error('the stub let a call reach the network')),
  ),
});

test('stubbed bot speech is PCM the real adapter accepts', async () => {
  const speech = await stubbed.speakPcm({
    model: 'deepgram/aura-2',
    voice: 'aura-2-thalia-en',
    text: 'One.',
  });
  assert({
    given: 'a PCM speech request answered by the OpenRouter stub',
    should: 'return three seconds of 24 kHz mono PCM',
    actual: [speech.sampleRate, speech.channels, speech.pcm.length],
    expected: [24000, 1, 72000],
  });
});
