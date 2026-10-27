import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createNatsHealth } from './health';

setupRitewayBun();

const buffer = { size: () => 3, pendingTallies: () => 2 };

describe('NATS health', () => {
  test('reports the connection state and counts reconnects', () => {
    const health = createNatsHealth();
    const states = [health.heartbeat('2026-10-27T13:01:53.439Z', buffer)];
    health.observe({ type: 'disconnect' });
    health.observe({ type: 'reconnecting' });
    states.push(health.heartbeat('2026-10-27T13:02:53.439Z', buffer));
    health.observe({ type: 'reconnect' });
    health.observe({ type: 'ping' });
    states.push(health.heartbeat('2026-10-27T13:03:53.439Z', buffer));
    health.observe({ type: 'close' });
    states.push(health.heartbeat('2026-10-27T13:04:53.439Z', buffer));
    assert({
      given: 'a disconnect, a reconnect and a close',
      should: 'report each state with the reconnect count and the backlog',
      actual: states.map((row) => [row.at, row.nats_state, row.reconnects]),
      expected: [
        ['2026-10-27 13:01:53', 'connected', 0],
        ['2026-10-27 13:02:53', 'disconnected', 0],
        ['2026-10-27 13:03:53', 'connected', 1],
        ['2026-10-27 13:04:53', 'closed', 1],
      ],
    });
  });

  test('carries the backlog', () => {
    const row = createNatsHealth().heartbeat(
      '2026-10-27T13:01:53.439Z',
      buffer,
    );
    assert({
      given: 'a buffer holding rows and tallies',
      should: 'report both counts',
      actual: [row.buffered, row.pending_tallies],
      expected: [3, 2],
    });
  });
});
