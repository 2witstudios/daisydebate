import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { waitForHealthy } from './wait-for-healthy';

setupRitewayBun();

const fakeSleep = () => {
  const calls: number[] = [];
  return { calls, sleep: async (ms: number) => void calls.push(ms) };
};

describe('waitForHealthy (ISSUE-146)', () => {
  test('returns true immediately once health answers true, sleeping nothing', async () => {
    const { calls, sleep } = fakeSleep();
    const result = await waitForHealthy({
      health: async () => true,
      sleep,
    });
    assert({
      given: 'a health check that is already true',
      should: 'resolve true without sleeping',
      actual: { result, sleepCalls: calls.length },
      expected: { result: true, sleepCalls: 0 },
    });
  });

  test('retries while health answers false, then succeeds', async () => {
    const { calls, sleep } = fakeSleep();
    let attempts = 0;
    const result = await waitForHealthy({
      health: async () => {
        attempts += 1;
        return attempts >= 3;
      },
      sleep,
      intervalMs: 250,
    });
    assert({
      given: 'a dependency that becomes healthy on the 3rd check',
      should: 'poll 3 times, sleeping between attempts, then resolve true',
      actual: { result, attempts, sleeps: calls },
      expected: { result: true, attempts: 3, sleeps: [250, 250] },
    });
  });

  test('a health rejection counts as not-yet-ready, not a thrown failure', async () => {
    const { sleep } = fakeSleep();
    let attempts = 0;
    const result = await waitForHealthy({
      health: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('connection refused');
        return true;
      },
      sleep,
    });
    assert({
      given: 'a health check that rejects once, then succeeds',
      should: 'treat the rejection as not-ready and keep polling to success',
      actual: result,
      expected: true,
    });
  });

  test('gives up after maxAttempts, reporting not healthy', async () => {
    const { calls, sleep } = fakeSleep();
    const result = await waitForHealthy({
      health: async () => false,
      sleep,
      maxAttempts: 4,
      intervalMs: 100,
    });
    assert({
      given: 'a dependency that never becomes healthy',
      should:
        'stop after maxAttempts, sleeping only between attempts, and report false',
      actual: { result, sleeps: calls },
      expected: { result: false, sleeps: [100, 100, 100] },
    });
  });
});
