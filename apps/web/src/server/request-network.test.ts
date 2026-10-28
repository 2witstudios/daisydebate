import type { IncomingMessage, ServerResponse } from 'node:http';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createIngressListener } from './ingress';
import { createRequestNetwork } from './request-network';

setupRitewayBun();

const request = (peer: string) =>
  ({
    socket: { remoteAddress: peer },
    headers: {},
  }) as unknown as IncomingMessage;
const response = () =>
  ({
    headersSent: false,
    writeHead: () => undefined,
    end: () => undefined,
  }) as unknown as ServerResponse;

describe('request network (ADR 0088 lane fairness)', () => {
  test('each request runs inside its own client network, across awaits', async () => {
    const network = createRequestNetwork();
    const seen: Array<string | undefined> = [];
    let resume = () => undefined as void;
    const paused = new Promise<void>((resolve) => (resume = resolve));
    const listen = createIngressListener({
      clientIdSubkey: 'request-network-subkey',
      isDraining: () => false,
      trustedProxies: [],
      withinClientNetwork: network.within,
      handle: async (incoming) => {
        if (incoming.socket.remoteAddress === '203.0.113.9') await paused;
        seen.push(network.current());
      },
      onError: () => undefined,
    });
    const first = listen(request('203.0.113.9'), response());
    await listen(request('2001:db8:5::1'), response());
    resume();
    await first;
    assert({
      given: 'two concurrent requests from different networks, one suspended',
      should:
        "key each one's work by its own network, never the other's or the address",
      actual: seen,
      expected: ['2001:0db8:0005::/48', '203.0.113.0/24'],
    });
  });

  test('outside a request there is no network', () => {
    assert({
      given: 'work started outside any request (a timer, a worker)',
      should: 'have no fairness key',
      actual: createRequestNetwork().current(),
      expected: undefined,
    });
  });

  test('two app instances keep separate contexts', () => {
    const one = createRequestNetwork();
    const two = createRequestNetwork();
    assert({
      given: "work run inside one instance's network",
      should: 'be invisible to another instance',
      actual: one.within('203.0.113.9', () => [one.current(), two.current()]),
      expected: ['203.0.113.0/24', undefined],
    });
  });
});
