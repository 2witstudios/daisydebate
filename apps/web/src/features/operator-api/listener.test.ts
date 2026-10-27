import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { resolveOperatorAddress, startOperatorListener } from './listener';

setupRitewayBun();

describe('the operator listener binding (ADR 0079)', () => {
  test('binds the resolved private address or a loopback literal, never a wildcard', async () => {
    const bound: { hostname: string; port: number }[] = [];
    let stopped = 0;
    const listener = await startOperatorListener({
      host: 'fly-local-6pn',
      port: 8081,
      handle: async () => new Response(null),
      resolve: async () => 'FDAA:0:1::2',
      serve: ({ hostname, port }) => {
        bound.push({ hostname, port });
        return { stop: () => (stopped += 1) };
      },
    });
    await listener.stop();
    assert({
      given: 'fly-local-6pn resolving to a 6PN address, then a shutdown',
      should: 'bind exactly that address and stop the server',
      actual: {
        bound,
        stopped,
        loopback: await resolveOperatorAddress('127.0.0.1', async () => '::'),
      },
      expected: {
        bound: [{ hostname: 'fdaa:0:1::2', port: 8081 }],
        stopped: 1,
        loopback: '127.0.0.1',
      },
    });
  });

  test('refuses to start when the private name resolves anywhere else', async () => {
    for (const address of ['::', '0.0.0.0', '2001:db8::1'])
      await expect(
        resolveOperatorAddress('fly-local-6pn', async () => address),
      ).rejects.toThrow(
        'fly-local-6pn did not resolve to a private 6PN address',
      );
  });
});
