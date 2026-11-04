import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createSelfSignedTlsEdge } from '../e2e/support/tls-edge';

setupRitewayBun();

test('the TLS edge forwards each request on its own upstream socket', async () => {
  let connections = 0;
  // Offers keep-alive, as the app server does.
  const upstream = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open() {
        connections += 1;
      },
      data(socket) {
        socket.write(
          'HTTP/1.1 200 OK\r\nConnection: keep-alive\r\nContent-Length: 2\r\n\r\nok',
        );
      },
    },
  });
  const edge = createSelfSignedTlsEdge({ appPort: upstream.port, edgePort: 0 });
  const through = async () =>
    (
      await fetch(`https://127.0.0.1:${edge.port}/room`, {
        // Bun: the edge's certificate is its own throwaway CA's.
        tls: { rejectUnauthorized: false },
      })
    ).text();
  try {
    const answers = [await through(), await through()];

    assert({
      given: 'two requests in a row to an upstream that offers keep-alive',
      should:
        'never reuse a socket the upstream may already be closing (ISSUE-1345)',
      actual: { answers, connections },
      expected: { answers: ['ok', 'ok'], connections: 2 },
    });
  } finally {
    edge.stop(true);
    upstream.stop(true);
  }
});
