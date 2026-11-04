import { afterEach, describe, test } from 'bun:test';
import { assert, setupRitewayBun } from 'riteway/bun';
import { createSelfSignedTlsEdge } from '../e2e/support/tls-edge';

setupRitewayBun();

/** A plain upstream offering keep-alive, as the app server does, counting its sockets. */
const keepAliveUpstream = () => {
  const state = { connections: 0 };
  const server = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open() {
        state.connections += 1;
      },
      data(socket) {
        socket.write(
          'HTTP/1.1 200 OK\r\nConnection: keep-alive\r\nContent-Length: 2\r\n\r\nok',
        );
      },
    },
  });
  return { state, server };
};

describe('the loopback TLS edge', () => {
  const stops: (() => void)[] = [];
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
  });

  test('forwards each request on its own upstream socket', async () => {
    const { state, server } = keepAliveUpstream();
    const edge = createSelfSignedTlsEdge({ appPort: server.port, edgePort: 0 });
    stops.push(
      () => server.stop(true),
      () => edge.stop(true),
    );
    const through = async () =>
      (
        await fetch(`https://127.0.0.1:${edge.port}/room`, {
          // Bun: the edge's certificate is its own throwaway CA's.
          tls: { rejectUnauthorized: false },
        })
      ).text();

    const answers = [await through(), await through()];

    assert({
      given: 'two requests in a row to an upstream that offers keep-alive',
      should:
        'never reuse a socket the upstream may already be closing (ISSUE-1345)',
      actual: { answers, connections: state.connections },
      expected: { answers: ['ok', 'ok'], connections: 2 },
    });
  });
});
