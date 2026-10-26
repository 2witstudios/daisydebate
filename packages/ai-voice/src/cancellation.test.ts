import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createOpenRouter, type OpenRouter } from './openrouter';
setupRitewayBun();
const request = (
  client: OpenRouter,
  kind: 'complete' | 'transcribe',
  signal: AbortSignal,
) =>
  kind === 'complete'
    ? client.complete({ model: 'test', messages: [], maxTokens: 1, signal })
    : client.transcribe({
        model: 'test',
        audioBase64: 'AA==',
        format: 'wav',
        signal,
      });

for (const kind of ['complete', 'transcribe'] as const) {
  test(`${kind} refuses cancellation before transport`, async () => {
    let calls = 0;
    const client = createOpenRouter({
      apiKey: 'unit-only',
      fetch: async () => {
        calls++;
        return Response.json({
          text: 'stale',
          choices: [{ message: { content: 'stale' } }],
        });
      },
    });
    await assertRejects({
      given: 'a stale lease cancelled before provider dispatch',
      should: 'refuse rather than consume a response',
      actual: () => request(client, kind, AbortSignal.abort()),
      code: 'CONFLICT',
    });
    assert({
      given: 'pre-dispatch cancellation',
      should: 'make no network call',
      actual: calls,
      expected: 0,
    });
  });

  test(`${kind} aborts actual HTTP response reading`, async () => {
    let received!: () => void;
    const readingBegan = new Promise<void>((resolve) => {
      received = resolve;
    });
    const controller = new AbortController();
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              stream.enqueue(new TextEncoder().encode('{"text":'));
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    });
    const client = createOpenRouter({
      apiKey: 'unit-only',
      timeoutMs: 2000,
      fetch: async (_url, init) => {
        const response = await fetch(server.url, init);
        const read = response.json.bind(response);
        Object.defineProperty(response, 'json', {
          value: () => {
            const body = read();
            received();
            return body;
          },
        });
        return response;
      },
    });
    try {
      const result = request(client, kind, controller.signal);
      await readingBegan;
      controller.abort();
      await assertRejects({
        given: 'an actual pending HTTP body after successful headers',
        should: 'abort response consumption without returning stale text',
        actual: () => result,
        code: 'CONFLICT',
      });
    } finally {
      server.stop(true);
    }
  });
}
