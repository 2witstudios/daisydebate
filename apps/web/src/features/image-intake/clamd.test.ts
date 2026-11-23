import { createServer, type Socket } from 'node:net';
import { assertRejects } from '@daisy/errors/testing';
import { setupRitewayBun, test } from 'riteway/bun';
import { virtualClock } from '@daisy/clock/testing';
import { createClamdScanner } from './clamd';
setupRitewayBun();
test('scanner transport rejects malformed, incomplete and daemon error replies', async () => {
  for (const reply of [
    'stream: UNKNOWN\0',
    'stream: OK',
    'INSTREAM size limit exceeded. ERROR\0',
  ]) {
    // Once: the client's chunks may arrive apart, and a second end throws.
    const server = createServer((socket) =>
      socket
        .once('data', () => {
          socket.end(reply);
        })
        .on('error', () => undefined),
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
          createClamdScanner(
            { host: '127.0.0.1', port: address.port },
            virtualClock(),
          ).scan(new Uint8Array([1]), { maxBytes: 100, serviceMs: 1000 }),
        code: 'INFRASTRUCTURE',
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }
});

test('a daemon that never replies fails closed at the service bound', async () => {
  const held = new Set<Socket>();
  const server = createServer((socket) => {
    held.add(socket);
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('TCP test endpoint required');
  const clock = virtualClock();
  try {
    const scan = createClamdScanner(
      { host: '127.0.0.1', port: address.port },
      clock,
    ).scan(new Uint8Array([1]), { maxBytes: 100, serviceMs: 1000 });
    scan.catch(() => undefined);
    await clock.advance(1000);
    await assertRejects({
      given: 'a daemon holding the connection past the service bound',
      should: 'never classify it clean',
      actual: () => scan,
      code: 'INFRASTRUCTURE',
    });
  } finally {
    for (const socket of held) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
