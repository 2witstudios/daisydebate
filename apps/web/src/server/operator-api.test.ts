import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { App } from './app';
import { startOperatorApi } from './operator-api';

setupRitewayBun();

/** A 32-byte base64url key, the shape OPERATOR_API_KEYS carries. */
const keys = `k20261027:${Buffer.alloc(32, 7).toString('base64url')}`;

const appWith = (config: Record<string, unknown>) => {
  const events: string[] = [];
  const app = {
    config: {
      OPERATOR_AUDIENCE: 'daisy-web:local',
      OPERATOR_LISTEN_HOST: '127.0.0.1',
      OPERATOR_PORT: 0,
      ...config,
    },
    logger: { log: (event: string) => events.push(event) },
    clock: { now: () => '2026-10-27T12:00:00.000Z' },
    ids: { next: () => 'i'.repeat(24) },
    redis: { admitOperatorNonce: async () => true },
    database: {},
  } as unknown as App;
  return { app, events };
};

const outcomeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'started',
    () => 'refused',
  );

test('the operator listener stays off without keys and refuses a bad configuration (ISSUE-684)', async () => {
  const off = appWith({ OPERATOR_API_KEYS: undefined });
  const disabled = await startOperatorApi(off.app);
  assert({
    given: 'no OPERATOR_API_KEYS, then malformed keys',
    should:
      'start nothing and say so, and refuse startup on keys it cannot parse',
    actual: {
      disabled,
      events: off.events,
      malformed: await outcomeOf(
        startOperatorApi(appWith({ OPERATOR_API_KEYS: 'not-a-key' }).app),
      ),
    },
    expected: {
      disabled: null,
      events: ['operator.listener.disabled'],
      malformed: 'refused',
    },
  });
});

test('a listener that cannot bind fails startup instead of running without it (ISSUE-684)', async () => {
  const started = appWith({ OPERATOR_API_KEYS: keys });
  const listener = await startOperatorApi(started.app);
  const taken = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response(),
  });
  try {
    const clash = await outcomeOf(
      startOperatorApi(
        appWith({ OPERATOR_API_KEYS: keys, OPERATOR_PORT: taken.port }).app,
      ),
    );
    assert({
      given:
        'valid keys on a free loopback port, then on a port already in use',
      should: 'listen and log it, and refuse the second start',
      actual: {
        bound: listener?.address,
        events: started.events,
        clash,
      },
      expected: {
        bound: '127.0.0.1',
        events: ['operator.listener.started'],
        clash: 'refused',
      },
    });
  } finally {
    await listener?.stop();
    await taken.stop();
  }
});
