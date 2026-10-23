import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixture, pendingRead, row, topic } from './registry.test-support';

setupRitewayBun();

for (const outcome of ['denied', 'unavailable'] as const)
  test(`a subscription whose authority read is ${outcome}`, async () => {
    const failure = new Error('connection reset');
    const failures: unknown[] = [];
    const { registry, connection, sent } = fixture({
      authorize: async () => {
        if (outcome === 'unavailable') throw failure;
        return null;
      },
      failed: (error) => {
        failures.push(error);
      },
    });
    await registry.subscribe(connection, { id: 'request', topic });
    assert({
      given: `an authority read that ${outcome === 'denied' ? 'denies the principal' : 'throws'}`,
      should:
        outcome === 'denied'
          ? 'refuse with AUTHORIZATION and report nothing'
          : 'refuse with the transient INFRASTRUCTURE code and report the failure',
      actual: {
        codes: sent.map((frame) =>
          frame.type === 'error' ? frame.code : frame.type,
        ),
        failures,
      },
      expected: {
        codes: [outcome === 'denied' ? 'AUTHORIZATION' : 'INFRASTRUCTURE'],
        failures: outcome === 'denied' ? [] : [failure],
      },
    });
  });

test('a write on the topic during the first authority read asks the subscriber to resynchronize', async () => {
  const { resolve, began, read } = pendingRead<{
    revision: string;
    validUntil: number;
  } | null>();
  const { registry, connection, sent } = fixture({ authorize: read });
  registry.seed({ txid: '1', seq: 1n });
  const pending = registry.subscribe(connection, { id: 'request', topic });
  await began;
  registry.sink([row(2)]);
  resolve({ revision: '1', validUntil: 60_000 });
  await pending;
  assert({
    given:
      'a room write landing while an allowed first authority read is in flight',
    should:
      'answer resync_required so the subscriber re-reads, never an AUTHORIZATION refusal',
    actual: sent.map((frame) =>
      frame.type === 'error' ? frame.code : frame.type,
    ),
    expected: ['resync_required'],
  });
});
