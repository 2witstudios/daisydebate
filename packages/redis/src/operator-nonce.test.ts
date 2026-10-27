import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createOfflineRedis, createTestRedis } from './test-support';

setupRitewayBun();

const nonce = {
  serviceId: 'daisy-admin',
  keyId: 'k20261026',
  nonce: 'n'.repeat(22),
  ttlSeconds: 120,
};

describe('admitOperatorNonce (ADR 0079)', () => {
  test('admits a nonce once per service and key, with an expiry', async () => {
    const { redis, commands } = createTestRedis();
    const first = await redis.admitOperatorNonce(nonce);
    const replay = await redis.admitOperatorNonce(nonce);
    const otherKey = await redis.admitOperatorNonce({
      ...nonce,
      keyId: 'k20261101',
    });
    assert({
      given:
        'a nonce, the same nonce again, and the same nonce under another key',
      should:
        'admit the first, refuse the replay, and scope admission to the key',
      actual: {
        outcomes: [first, replay, otherKey],
        command: commands.find(({ command }) => command === 'SET'),
      },
      expected: {
        outcomes: [true, false, true],
        command: {
          command: 'SET',
          args: [
            `test:v1:operator-nonce:daisy-admin:k20261026:${'n'.repeat(22)}`,
            '1',
            'NX',
            'EX',
            '120',
          ],
        },
      },
    });
  });

  test('an outage throws so the caller fails closed', async () => {
    const events: { event: string; fields: Record<string, unknown> }[] = [];
    await expect(
      createOfflineRedis(events).admitOperatorNonce(nonce),
    ).rejects.toThrow('offline');
  });
});
