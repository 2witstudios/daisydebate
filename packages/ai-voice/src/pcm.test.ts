import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createOpenRouter } from './openrouter';

setupRitewayBun();
test('Aura PCM validates actual wire format and returns signed samples without transcript credit', async () => {
  let body: unknown;
  const voice = createOpenRouter({
    apiKey: 'test-only',
    fetch: async (_url, init) => {
      body = JSON.parse(String(init.body));
      return new Response(new Uint8Array([0, 128, 255, 127, 0, 0]), {
        headers: { 'content-type': 'audio/pcm;rate=24000;channels=1' },
      });
    },
  });
  const output = await voice.speakPcm({
    model: 'deepgram/aura-2',
    voice: 'aura-2-thalia-en',
    text: 'Test.',
  });
  assert({
    given: 'validated 24k mono signed little-endian PCM16',
    should:
      'return samples and exact wire metadata without a transcript completion claim',
    actual: { body, output: { ...output, pcm: [...output.pcm] } },
    expected: {
      body: {
        model: 'deepgram/aura-2',
        voice: 'aura-2-thalia-en',
        input: 'Test.',
        response_format: 'pcm',
        provider: { zdr: true },
      },
      output: {
        pcm: [-32768, 32767, 0],
        sampleRate: 24000,
        channels: 1,
        characters: 5,
      },
    },
  });
});
for (const [type, data] of [
  ['audio/mpeg', new Uint8Array([0, 0])],
  ['audio/pcm', new Uint8Array([0, 0])],
  ['audio/pcm;rate=48000;channels=1', new Uint8Array([0, 0])],
  ['audio/pcm;rate=24000;channels=2', new Uint8Array([0, 0])],
  ['audio/pcm;rate=24000;channels=1', new Uint8Array([0])],
  ['audio/pcm;rate=24000;channels=1', new Uint8Array()],
  ['audio/pcm;rate=24000;channels=1', new Uint8Array(24000 * 2 * 60 + 2)],
] as const)
  test(`refuses unusable PCM envelope ${type}/${data.length}`, async () => {
    const voice = createOpenRouter({
      apiKey: 'test-only',
      fetch: async () =>
        new Response(data, { headers: { 'content-type': type } }),
    });
    await assertRejects({
      given: 'missing, incompatible, odd, empty or overlong provider PCM',
      should: 'fail before any publication can consume it',
      actual: () =>
        voice.speakPcm({
          model: 'deepgram/aura-2',
          voice: 'aura-2-thalia-en',
          text: 'Test.',
        }),
      code: 'INFRASTRUCTURE',
    });
  });
test('cancelled speech dispatch never calls the provider', async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  let calls = 0;
  const voice = createOpenRouter({
    apiKey: 'test-only',
    fetch: async () => {
      calls++;
      return new Response();
    },
  });
  await assertRejects({
    given: 'a revoked publication before dispatch',
    should: 'refuse without a provider call',
    actual: () =>
      voice.speakPcm({
        model: 'deepgram/aura-2',
        voice: 'aura-2-thalia-en',
        text: 'Test.',
        signal: cancelled.signal,
      }),
    code: 'CONFLICT',
  });
  assert({
    given: 'pre-dispatch cancellation',
    should: 'spend no provider request',
    actual: calls,
    expected: 0,
  });
});
