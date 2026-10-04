import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createOpenRouter, type Fetch } from './openrouter';

setupRitewayBun();

type Call = { url: string; init: RequestInit };

const recording = (respond: (call: Call) => Response) => {
  const calls: Call[] = [];
  const fetch: Fetch = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  };
  return { calls, fetch };
};

const bodyOf = (call: Call) =>
  JSON.parse(String(call.init.body)) as Record<string, unknown>;

describe('complete', () => {
  test('sends a chat completion with zero data retention and reads the text', async () => {
    const { calls, fetch } = recording(() =>
      Response.json({
        choices: [{ message: { content: 'Hello, judge.' } }],
        usage: { prompt_tokens: 12, completion_tokens: 4 },
      }),
    );
    const client = createOpenRouter({ apiKey: 'key-1', fetch });
    const result = await client.complete({
      model: 'openai/gpt-6-luna',
      messages: [{ role: 'user', content: 'Hi' }],
      maxTokens: 50,
    });
    const call = calls[0]!;
    assert({
      given: 'a completion request',
      should: 'post to the chat completions endpoint',
      actual: call.url,
      expected: 'https://openrouter.ai/api/v1/chat/completions',
    });
    assert({
      given: 'a completion request',
      should: 'authorize with the API key',
      actual: new Headers(call.init.headers).get('authorization'),
      expected: 'Bearer key-1',
    });
    assert({
      given: 'a completion request',
      should: 'route only to zero-data-retention providers',
      actual: bodyOf(call).provider,
      expected: { zdr: true },
    });
    assert({
      given: 'a completion response',
      should: 'return the text and token usage',
      actual: result,
      expected: {
        text: 'Hello, judge.',
        promptTokens: 12,
        completionTokens: 4,
      },
    });
  });

  test('a vendor failure is an infrastructure error without the body', async () => {
    const { fetch } = recording(
      () => new Response('secret provider detail', { status: 502 }),
    );
    const client = createOpenRouter({ apiKey: 'k', fetch });
    await assertRejects({
      given: 'a 502 from OpenRouter',
      should: 'refuse with INFRASTRUCTURE',
      actual: () => client.complete({ model: 'm', messages: [], maxTokens: 1 }),
      code: 'INFRASTRUCTURE',
    });
  });
});

describe('reasoning', () => {
  test('sends the reasoning effort and keeps reasoning out of the answer', async () => {
    const { calls, fetch } = recording(() =>
      Response.json({ choices: [{ message: { content: 'Ok.' } }] }),
    );
    const client = createOpenRouter({ apiKey: 'k', fetch });
    await client.complete({
      model: 'm',
      messages: [],
      maxTokens: 9,
      reasoning: 'none',
    });
    assert({
      given: 'a request with a reasoning effort',
      should: 'send the effort with reasoning excluded from the answer',
      actual: bodyOf(calls[0]!).reasoning,
      expected: { effort: 'none', exclude: true },
    });
  });
});

describe('stream', () => {
  test('yields the content deltas of a server-sent event stream', async () => {
    const events = [
      ': OPENROUTER PROCESSING',
      'data: {"choices":[{"delta":{"content":"Thank "}}]}',
      'data: {"choices":[{"delta":{"content":"you."}}]}',
      'data: [DONE]',
      '',
    ].join('\n\n');
    const { calls, fetch } = recording(() => new Response(events));
    const client = createOpenRouter({ apiKey: 'k', fetch });
    const deltas: string[] = [];
    for await (const delta of client.stream({
      model: 'm',
      messages: [],
      maxTokens: 9,
    }))
      deltas.push(delta);
    assert({
      given: 'a streamed completion',
      should: 'ask for a stream',
      actual: bodyOf(calls[0]!).stream,
      expected: true,
    });
    assert({
      given: 'two content deltas, a comment and the done marker',
      should: 'yield only the deltas',
      actual: deltas,
      expected: ['Thank ', 'you.'],
    });
  });
});

describe('speak', () => {
  test('requests mp3 speech and returns the bytes with the characters billed', async () => {
    const { calls, fetch } = recording(
      () => new Response(new Uint8Array([1, 2, 3])),
    );
    const client = createOpenRouter({ apiKey: 'k', fetch });
    const result = await client.speak({
      model: 'hexgrad/kokoro-82m',
      voice: 'am_michael',
      text: 'Hi there.',
    });
    assert({
      given: 'a speech request',
      should: 'post the text, voice and mp3 format to the speech endpoint',
      actual: { url: calls[0]!.url, body: bodyOf(calls[0]!) },
      expected: {
        url: 'https://openrouter.ai/api/v1/audio/speech',
        body: {
          model: 'hexgrad/kokoro-82m',
          input: 'Hi there.',
          voice: 'am_michael',
          response_format: 'mp3',
          provider: { zdr: true },
        },
      },
    });
    assert({
      given: 'audio bytes back',
      should: 'return them and the characters billed',
      actual: {
        bytes: [...new Uint8Array(result.audio)],
        characters: result.characters,
      },
      expected: { bytes: [1, 2, 3], characters: 9 },
    });
  });
});

describe('transcribe', () => {
  test('sends base64 audio and returns the text', async () => {
    const { calls, fetch } = recording(() =>
      Response.json({ text: ' I affirm. ' }),
    );
    const client = createOpenRouter({ apiKey: 'k', fetch });
    const result = await client.transcribe({
      model: 'openai/whisper-large-v3-turbo',
      audioBase64: 'AAAA',
      format: 'webm',
    });
    assert({
      given: 'a transcription request',
      should: 'post the audio, format and English hint',
      actual: { url: calls[0]!.url, body: bodyOf(calls[0]!) },
      expected: {
        url: 'https://openrouter.ai/api/v1/audio/transcriptions',
        body: {
          model: 'openai/whisper-large-v3-turbo',
          input_audio: { data: 'AAAA', format: 'webm' },
          language: 'en',
          provider: { zdr: true },
        },
      },
    });
    assert({
      given: 'a transcript with surrounding whitespace',
      should: 'return the trimmed text',
      actual: result.text,
      expected: 'I affirm.',
    });
  });
});

describe('unreadable answers', () => {
  const failingBody = () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":'));
          controller.error(new TypeError('connection reset'));
        },
      }),
    );

  test('every unreadable answer is an infrastructure error', async () => {
    const malformed = createOpenRouter({
      apiKey: 'k',
      fetch: async () => new Response('not json', { status: 200 }),
    });
    await assertRejects({
      given: 'a completion answer that is not JSON',
      should: 'reject with INFRASTRUCTURE, not a raw SyntaxError',
      actual: () =>
        malformed.complete({
          model: 'm',
          messages: [{ role: 'user', content: 'Hi' }],
          maxTokens: 5,
        }),
      code: 'INFRASTRUCTURE',
    });
    const dropped = createOpenRouter({
      apiKey: 'k',
      fetch: async () => failingBody(),
    });
    await assertRejects({
      given: 'a stream whose connection drops mid-answer',
      should: 'reject with INFRASTRUCTURE',
      actual: async () => {
        for await (const delta of dropped.stream({
          model: 'm',
          messages: [{ role: 'user', content: 'Hi' }],
          maxTokens: 5,
        }))
          void delta;
      },
      code: 'INFRASTRUCTURE',
    });
    await assertRejects({
      given: 'speech audio whose body drops mid-read',
      should: 'reject with INFRASTRUCTURE',
      actual: () => dropped.speak({ model: 'm', voice: 'v', text: 'Hi.' }),
      code: 'INFRASTRUCTURE',
    });
  });
});
