import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  TEST_KEY_TTL_MAX_MS,
  TEST_NAMESPACE_PREFIX,
  TEST_RUN_MAX_MS,
  testNamespace,
  withBoundedExpiry,
} from './testing';

setupRitewayBun();

type Sent = { readonly command: string; readonly args: readonly string[] };

/** Records what reaches the wire; every command answers with `reply`. */
function recordingClient(reply: unknown = 'OK') {
  const sent: Sent[] = [];
  const client = {
    connected: true,
    async send(command: string, args: string[]) {
      sent.push({ command, args });
      return reply;
    },
    async get(key: string) {
      sent.push({ command: 'GET', args: [key] });
      return null;
    },
    async connect() {},
    close() {},
    async set() {
      throw new Error('the raw set helper must never be reached');
    },
  };
  return { client: client as never, sent };
}

const MAX = 7_200_000;
const boundOf = (sent: readonly Sent[], key: string) =>
  sent.find(
    ({ command, args }) =>
      command === 'EVAL' && args[0]?.includes('PTTL') && args.includes(key),
  );

describe('test namespaces', () => {
  test('carry the sweepable prefix and fit REDIS_NAMESPACE', () => {
    const namespace = testNamespace('abcdefghijklmnopqrstuvwx');

    assert({
      given: 'a cuid2',
      should: 'name a t3- namespace of ten id characters',
      actual: { namespace, prefix: TEST_NAMESPACE_PREFIX },
      expected: { namespace: 't3-abcdefghij', prefix: 't3-' },
    });
  });

  test('a key lives well past a run, and a run is bounded below the key limit', () => {
    assert({
      given: 'the run and key limits',
      should: 'let a key outlive the idle window the sweep uses',
      actual: TEST_KEY_TTL_MAX_MS > TEST_RUN_MAX_MS,
      expected: true,
    });
  });
});

describe('withBoundedExpiry', () => {
  test('a SET with no expiry gets one in the same command', async () => {
    const { client, sent } = recordingClient();
    const bounded = withBoundedExpiry(client, MAX);

    await bounded.send('SET', ['t3-a:v1:k', 'v']);

    assert({
      given: 'a SET that forgot its expiry',
      should: 'reach Redis as SET ... PX <ceiling>, never immortal',
      actual: sent[0],
      expected: {
        command: 'SET',
        args: ['t3-a:v1:k', 'v', 'PX', String(MAX)],
      },
    });
  });

  test('a SET with its own short expiry is left as written, then capped', async () => {
    const { client, sent } = recordingClient();
    const bounded = withBoundedExpiry(client, MAX);

    await bounded.send('SET', ['t3-a:v1:k', 'v', 'EX', '60']);

    assert({
      given: 'a SET EX 60',
      should: 'keep the 60 s expiry and follow with the ceiling script',
      actual: {
        first: sent[0],
        capped: boundOf(sent, 't3-a:v1:k') !== undefined,
      },
      expected: {
        first: {
          command: 'SET',
          args: ['t3-a:v1:k', 'v', 'EX', '60'],
        },
        capped: true,
      },
    });
  });

  test('every key a script declares is capped after it runs', async () => {
    const { client, sent } = recordingClient(1);
    const bounded = withBoundedExpiry(client, MAX);

    await bounded.send('EVAL', ['return 1', '2', 'k1', 'k2', 'argv']);

    const cap = boundOf(sent, 'k1');
    assert({
      given: 'an EVAL declaring two keys',
      should: 'cap both keys in one follow-up script at the ceiling',
      actual: cap && {
        keyCount: cap.args[1],
        keys: cap.args.slice(2, 4),
        ceiling: cap.args[4],
      },
      expected: { keyCount: '2', keys: ['k1', 'k2'], ceiling: String(MAX) },
    });
  });

  test('a write returns the command reply, not the cap reply', async () => {
    const { client } = recordingClient('the-reply');
    const bounded = withBoundedExpiry(client, MAX);

    assert({
      given: 'a SET',
      should: 'return what SET answered',
      actual: await bounded.send('SET', ['k', 'v', 'EX', '5']),
      expected: 'the-reply',
    });
  });

  test('reads and deletes pass through untouched', async () => {
    const { client, sent } = recordingClient();
    const bounded = withBoundedExpiry(client, MAX);

    await bounded.send('PTTL', ['k']);
    await bounded.send('UNLINK', ['k']);
    await bounded.get('k');

    assert({
      given: 'PTTL, UNLINK and GET',
      should: 'send only those commands',
      actual: sent.map(({ command }) => command),
      expected: ['PTTL', 'UNLINK', 'GET'],
    });
  });

  test('a command whose keys it cannot attribute is refused, not written', async () => {
    const { client, sent } = recordingClient();
    const bounded = withBoundedExpiry(client, MAX);

    await expect(bounded.send('RESTORE', ['k', '0', 'x'])).rejects.toThrow(
      'cannot bound the expiry of RESTORE',
    );
    assert({
      given: 'a write command outside the known table',
      should: 'never reach Redis',
      actual: sent,
      expected: [],
    });
  });

  test('a raw write helper is refused so it cannot bypass the ceiling', () => {
    const { client } = recordingClient();
    const bounded = withBoundedExpiry(client, MAX);

    expect(() => (bounded as unknown as { set: () => void }).set()).toThrow(
      'cannot bound the expiry',
    );
  });

  test('connection state and lifecycle pass through', async () => {
    const { client } = recordingClient();
    const bounded = withBoundedExpiry(client, MAX);

    assert({
      given: 'the wrapped client',
      should: 'expose the real connected flag',
      actual: bounded.connected,
      expected: true,
    });
    await bounded.connect();
    bounded.close();
  });
});
