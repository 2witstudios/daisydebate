import { createServer } from 'node:net';
import { assertRejects } from '@daisy/errors/testing';
import { setupRitewayBun, test } from 'riteway/bun';
import { createClamdScanner } from './clamd';
setupRitewayBun();
test('scanner transport rejects malformed, incomplete and daemon error replies', async () => {
  for (const reply of [
    'stream: UNKNOWN\0',
    'stream: OK',
    'INSTREAM size limit exceeded. ERROR\0',
  ]) {
    const server = createServer((socket) =>
      socket.on('data', () => {
        socket.end(reply);
      }),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('TCP test endpoint required');
    try {
      await assertRejects({
        given: 'an inconclusive daemon response',
        should: 'never classify it clean',
        actual: () =>
          createClamdScanner({ host: '127.0.0.1', port: address.port }).scan(
            new Uint8Array([1]),
            { maxBytes: 100, serviceMs: 1000 },
          ),
        code: 'INFRASTRUCTURE',
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
});
