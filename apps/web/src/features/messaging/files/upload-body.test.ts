import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { readBytes } from '../../../server/http';
setupRitewayBun();
test('binary upload bounds streamed bytes independent of the claimed content length', async () => {
  const request = new Request('https://example.test/upload', {
    method: 'POST',
    body: new Uint8Array([1, 2, 3]),
    headers: { 'content-length': '1' },
  });
  await assertRejects({
    given: 'body larger than the deployment-injected file bound',
    should: 'refuse before private storage',
    actual: () => readBytes(request, 2),
    code: 'PAYLOAD_TOO_LARGE',
  });
  const exact = new Request('https://example.test/upload', {
    method: 'POST',
    body: new Uint8Array([1, 2, 3]),
  });
  assert({
    given: 'exact bounded binary content',
    should: 'preserve all bytes without logging or content-type coercion',
    actual: [...(await readBytes(exact, 3))],
    expected: [1, 2, 3],
  });
});

test('the shared member boundary can return authorized binary content without JSON serialization', async () => {
  const { runMessagingHandler } = await import('../handler-boundary');
  const { silentLogger } =
    await import('../../../server/test-loggers.test-support');
  const response = await runMessagingHandler(
    {
      logger: silentLogger,
      origin: () => 'https://example.test',
      identify: async () => ({
        state: 'member',
        username: 'ada',
        principal: {
          kind: 'user',
          userId: 'u'.repeat(24),
          actorId: 'a'.repeat(24),
        },
      }),
    },
    new Request('https://example.test/file'),
    {
      name: 'messaging.file.read',
      readOnly: true,
      readInput: async () => null,
      operation: async () => new Response(new Uint8Array([1, 2, 3])),
      respond: (value) => {
        if (!(value instanceof Response))
          throw new Error('Expected authorized response');
        return value;
      },
    },
  );
  assert({
    given: 'authorized binary response from the actual operation boundary',
    should: 'preserve bytes and retain no-store correlation behavior',
    actual: [
      [...new Uint8Array(await response.arrayBuffer())],
      response.headers.get('cache-control'),
      response.headers.has('x-request-id'),
    ],
    expected: [[1, 2, 3], 'no-store', true],
  });
});
