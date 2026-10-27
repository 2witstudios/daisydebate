import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { coverageSchema } from './store';

setupRitewayBun();

const rows = {
  heartbeat: {
    at: '2026-10-27 12:59:30',
    nats_state: 'connected',
    reconnects: '0',
  },
  apps: [
    { app: 'daisy-debate-staging', last_received: '2026-10-27 12:59:59.120' },
  ],
  flow: [{ app: 'daisy-debate-staging', admitted: '3600', dropped: '0' }],
  oldest: [{ store: 'events', oldest: '2026-10-20 00:00:00.000' }],
  lastSweep: '2026-10-27 12:30:00',
};

describe('coverage rows', () => {
  test('parse what ClickHouse returns', () => {
    assert({
      given: 'well-formed coverage rows, and none for an idle store',
      should: 'parse both',
      actual: [
        coverageSchema.safeParse(rows).success,
        coverageSchema.safeParse({ ...rows, heartbeat: null, lastSweep: null })
          .success,
      ],
      expected: [true, true],
    });
  });

  test('refuse a malformed heartbeat rather than reading it as live', () => {
    assert({
      given: 'a heartbeat with a null or odd time, and a negative count',
      should: 'fail the parse, so the page shows the store as unreachable',
      actual: [
        coverageSchema.safeParse({
          ...rows,
          heartbeat: { ...rows.heartbeat, at: null },
        }).success,
        coverageSchema.safeParse({
          ...rows,
          heartbeat: { ...rows.heartbeat, at: 'yesterday' },
        }).success,
        coverageSchema.safeParse({
          ...rows,
          flow: [{ app: 'daisy-debate-staging', admitted: -1, dropped: '0' }],
        }).success,
      ],
      expected: [false, false, false],
    });
  });
});
