import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createOpenRouter,
  isDefiniteProviderFailure,
  type Fetch,
} from './openrouter';

setupRitewayBun();

const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const delta = (content: string) => event({ choices: [{ delta: { content } }] });
const sse = (chunks: readonly string[], status = 200) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks)
          controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
    { status },
  );
const request = { model: 'm', messages: [], maxTokens: 10 } as const;
/** Streams an answer and reports the text handed on, then the outcome. */
const streamed = async (fetch: Fetch, signal?: AbortSignal) => {
  const heard: string[] = [];
  const outcome = await createOpenRouter({ apiKey: 'k', fetch })
    .completeStreamed({ ...request, ...(signal ? { signal } : {}) }, (text) =>
      heard.push(text),
    )
    .then(
      (result) => result,
      (error: unknown) =>
        isDefiniteProviderFailure(error) ? 'definite' : 'uncertain',
    );
  return { heard, outcome };
};

describe('completeStreamed', () => {
  test('hands text on as it arrives and reports usage at the end', async () => {
    let body: Record<string, unknown> = {};
    const result = await streamed(async (_url, init) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return sse([
        ': OPENROUTER PROCESSING\n\n',
        delta('Thank you. '),
        delta('I stand'),
        event({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
        event({
          choices: [],
          usage: { prompt_tokens: 120, completion_tokens: 7 },
        }),
        'data: [DONE]\n\n',
      ]);
    });
    assert({
      given: 'a streamed answer',
      should: 'ask for a stream with usage under zero retention',
      actual: {
        stream: body['stream'],
        usage: body['usage'],
        provider: body['provider'],
      },
      expected: {
        stream: true,
        usage: { include: true },
        provider: { zdr: true },
      },
    });
    assert({
      given: 'a streamed answer',
      should: 'hand on each piece in order and resolve with the whole answer',
      actual: result,
      expected: {
        heard: ['Thank you. ', 'I stand'],
        outcome: {
          text: 'Thank you. I stand',
          finish: 'stop',
          refused: false,
          promptTokens: 120,
          completionTokens: 7,
        },
      },
    });
  });

  test('a stream that does not finish is an uncertain failure', async () => {
    const early = await streamed(async () => sse([delta('Half an ans')]));
    const failed = await streamed(async () =>
      sse([delta('Half. '), event({ error: { code: 502 } })]),
    );
    const malformed = await streamed(async () => sse(['data: not json\n\n']));
    assert({
      given:
        'a stream that ends before its end marker, one that reports an error and one that is not JSON',
      should: 'keep the text already handed on and fail as possibly served',
      actual: [early, failed, malformed],
      expected: [
        { heard: ['Half an ans'], outcome: 'uncertain' },
        { heard: ['Half. '], outcome: 'uncertain' },
        { heard: [], outcome: 'uncertain' },
      ],
    });
  });

  test('a refused request is a definite failure before any text', async () => {
    assert({
      given: 'a 400 answer and a call cancelled before it was sent',
      should: 'fail as certainly unserved',
      actual: [
        await streamed(async () => sse([], 400)),
        await streamed(async () => sse([]), AbortSignal.abort()),
      ],
      expected: [
        { heard: [], outcome: 'definite' },
        { heard: [], outcome: 'definite' },
      ],
    });
  });
});

test('a stream may run longer than the adapter timeout, which bounds only its start', async () => {
  const slow = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) =>
        controller.enqueue(new TextEncoder().encode(text));
      for (const word of ['One. ', 'Two. ', 'Three.']) {
        send(delta(word));
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      send('data: [DONE]\n\n');
      controller.close();
    },
  });
  const heard: string[] = [];
  const answer = await createOpenRouter({
    apiKey: 'k',
    fetch: async () => new Response(slow),
    timeoutMs: 50,
  }).completeStreamed(request, (text) => heard.push(text));
  assert({
    given: 'a stream that takes 120 ms to write under a 50 ms adapter timeout',
    should: 'be read to its end',
    actual: [heard.length, answer.text],
    expected: [3, 'One. Two. Three.'],
  });
  const never = await createOpenRouter({
    apiKey: 'k',
    fetch: (_url, init) =>
      new Promise<Response>((_resolve, reject) =>
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        ),
      ),
    timeoutMs: 30,
  })
    .completeStreamed(request, () => undefined)
    .then(
      () => 'answered',
      () => 'failed',
    );
  assert({
    given: 'a streamed request whose response never begins',
    should: 'fail at the adapter timeout',
    actual: never,
    expected: 'failed',
  });
});
