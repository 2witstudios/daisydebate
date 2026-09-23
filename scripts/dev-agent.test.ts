import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  formatAgentReady,
  waitForReadiness,
  type AgentCredential,
} from './dev-agent';

setupRitewayBun();

describe('formatAgentReady', () => {
  test('prints local URLs, non-secret seeded credentials, and the seed version', () => {
    const credentials: readonly AgentCredential[] = [
      { username: 'agent-alice', userId: 'alice-id' },
      { username: 'agent-bob', userId: 'bob-id' },
    ];

    assert({
      given: 'a ready agent environment',
      should: 'print the connection details without database secrets',
      actual: formatAgentReady({
        appUrl: 'http://localhost:3000',
        realtimeUrl: 'http://localhost:3001',
        credentials,
        seedVersion: 'agent-seed-v1',
      }),
      expected: [
        'Daisy agent development ready',
        'Web: http://localhost:3000',
        'Health: http://localhost:3000/api/health/ready',
        'Realtime: http://localhost:3001',
        'Realtime health: http://localhost:3001/health/ready',
        'Credentials:',
        '  agent-alice (alice-id)',
        '  agent-bob (bob-id)',
        'Seed version: agent-seed-v1',
        '',
      ].join('\n'),
    });
  });
});

describe('waitForReadiness', () => {
  test('retries until the readiness endpoint returns success', async () => {
    let attempts = 0;
    const responses = [503, 200];

    await waitForReadiness('http://localhost:3000/api/health/ready', {
      fetch: async () => {
        attempts += 1;
        return new Response(null, { status: responses[attempts - 1] });
      },
      delay: async () => {},
      timeoutMs: 100,
      intervalMs: 1,
    });

    assert({
      given: 'a web process that becomes ready',
      should: 'poll until it is ready',
      actual: attempts,
      expected: 2,
    });
  });
});
